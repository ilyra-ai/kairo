// ============================================================================
// Kairo — Termômetro de energia e cronotipo (Tarefa 23)
// ============================================================================
//
// Registra o nível de energia do usuário com um toque, associa data/hora e
// contexto, e — a partir de uma amostra mínima — deriva o cronotipo (picos e
// vales por hora) e sugere as melhores janelas para tarefas de alta carga.
//
// Princípios: dados por usuário (isolamento), sem diagnóstico médico, sempre
// com nível de confiança e explicação quando faltam dados. O usuário pode
// desativar o recurso e excluir todos os registros e derivados.

import { notFound, unprocessable } from '../../shared/http-error.js';

// Amostra mínima para revelar padrões — abaixo disso, só coleta.
export const AMOSTRA_MINIMA = 8;
// Escala acessível de 1 (muito baixa) a 5 (muito alta).
export const NIVEIS_DE_ENERGIA = Object.freeze([1, 2, 3, 4, 5]);
export const CONTEXTOS = Object.freeze([
  'ao-acordar',
  'manha',
  'pos-almoco',
  'tarde',
  'noite',
  'apos-tarefa',
  'apos-pausa'
]);

export function ensureEnergySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energy_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
      context TEXT,
      logged_date DATE NOT NULL,
      logged_hour INTEGER NOT NULL CHECK (logged_hour BETWEEN 0 AND 23),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_energy_logs_owner
      ON energy_logs (user_id, logged_date, logged_hour);

    CREATE TABLE IF NOT EXISTS energy_settings (
      user_id INTEGER PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);
}

function serialize(row) {
  return {
    id: Number(row.id),
    level: Number(row.level),
    context: row.context,
    logged_date: row.logged_date,
    logged_hour: Number(row.logged_hour),
    created_at: row.created_at
  };
}

export function createEnergyService({ db, now = () => new Date() } = {}) {
  if (!db) throw new TypeError('O banco de dados é obrigatório para o serviço de energia.');
  ensureEnergySchema(db);

  function isEnabled(userId) {
    const row = db.get('SELECT enabled FROM energy_settings WHERE user_id = ?', [userId]);
    return !row || Number(row.enabled) === 1;
  }

  function setEnabled(userId, enabled) {
    db.run(
      `INSERT INTO energy_settings (user_id, enabled, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP`,
      [userId, enabled ? 1 : 0]
    );
    return { enabled: Boolean(enabled) };
  }

  // Registra um nível de energia (um toque). Data/hora derivadas do servidor.
  function log(userId, input) {
    if (!isEnabled(userId)) {
      throw unprocessable(
        'O termômetro de energia está desativado nas suas configurações.',
        'ENERGIA_DESATIVADA'
      );
    }
    if (!NIVEIS_DE_ENERGIA.includes(input.level)) {
      throw unprocessable('Nível de energia inválido (use de 1 a 5).', 'NIVEL_INVALIDO');
    }
    if (input.context && !CONTEXTOS.includes(input.context)) {
      throw unprocessable('Contexto inválido.', 'CONTEXTO_INVALIDO');
    }
    const agora = now();
    const data = agora.toISOString().slice(0, 10);
    const hora = agora.getHours();
    const result = db.run(
      `INSERT INTO energy_logs (user_id, level, context, logged_date, logged_hour)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, input.level, input.context ?? null, data, hora]
    );
    return serialize(db.get('SELECT * FROM energy_logs WHERE id = ?', [result.lastID]));
  }

  function recent(userId, limite = 30) {
    return db
      .all(
        `SELECT * FROM energy_logs WHERE user_id = ?
         ORDER BY logged_date DESC, logged_hour DESC, id DESC LIMIT ?`,
        [userId, Math.min(Math.max(Number(limite) || 30, 1), 200)]
      )
      .map(serialize);
  }

  // Heatmap: média de energia por hora do dia, com contagem de amostras.
  function heatmap(userId) {
    const linhas = db.all(
      `SELECT logged_hour AS hour,
              ROUND(AVG(level), 2) AS avg_level,
              COUNT(*) AS samples
       FROM energy_logs WHERE user_id = ?
       GROUP BY logged_hour ORDER BY logged_hour`,
      [userId]
    );
    const porHora = new Map(
      linhas.map((l) => [
        Number(l.hour),
        { avg_level: Number(l.avg_level), samples: Number(l.samples) }
      ])
    );
    const horas = [];
    for (let h = 0; h < 24; h += 1) {
      const dados = porHora.get(h);
      horas.push({
        hour: h,
        avg_level: dados ? dados.avg_level : null,
        samples: dados ? dados.samples : 0
      });
    }
    return horas;
  }

  /**
   * Cronotipo derivado dos dados reais. Só revela padrões com amostra mínima;
   * caso contrário explica que faltam dados. Sempre acompanha nível de
   * confiança (proporção da amostra até um teto saudável) — sem diagnóstico.
   */
  function insights(userId) {
    const total = Number(
      db.get('SELECT COUNT(*) AS total FROM energy_logs WHERE user_id = ?', [userId]).total
    );
    if (total < AMOSTRA_MINIMA) {
      return {
        ready: false,
        samples: total,
        required: AMOSTRA_MINIMA,
        message: `Registre pelo menos ${AMOSTRA_MINIMA} medições de energia para revelarmos o seu ritmo. Você tem ${total} até agora.`,
        peaks: [],
        troughs: [],
        confidence: 0,
        suggestion: null
      };
    }

    const mapa = heatmap(userId).filter((h) => h.samples > 0);
    const ordenadosPorEnergia = [...mapa].sort((a, b) => b.avg_level - a.avg_level);
    const peaks = ordenadosPorEnergia
      .slice(0, 3)
      .map((h) => ({ hour: h.hour, avg_level: h.avg_level }));
    const troughs = ordenadosPorEnergia
      .slice(-3)
      .reverse()
      .map((h) => ({ hour: h.hour, avg_level: h.avg_level }));

    // Confiança cresce com a amostra até um teto de 40 medições.
    const confidence = Math.min(1, total / 40);

    const melhorHora = peaks[0]?.hour;
    const suggestion =
      melhorHora === undefined
        ? null
        : {
            hour: melhorHora,
            reason: `Seu maior nível médio de energia acontece por volta das ${String(melhorHora).padStart(2, '0')}h. É a melhor janela para tarefas de alta carga cognitiva.`,
            confidence: Math.round(confidence * 100) / 100
          };

    return {
      ready: true,
      samples: total,
      required: AMOSTRA_MINIMA,
      peaks,
      troughs,
      confidence: Math.round(confidence * 100) / 100,
      suggestion,
      disclaimer:
        'Estas informações refletem apenas os seus próprios registros e não constituem diagnóstico médico.'
    };
  }

  function remove(userId, logId) {
    const existe = db.get('SELECT id FROM energy_logs WHERE id = ? AND user_id = ?', [
      logId,
      userId
    ]);
    if (!existe) throw notFound('Registro de energia não encontrado.', 'ENERGIA_NAO_ENCONTRADA');
    db.run('DELETE FROM energy_logs WHERE id = ? AND user_id = ?', [logId, userId]);
    return { deleted: true };
  }

  // Exclusão total: remove todos os registros e derivados do usuário.
  function purge(userId) {
    const total = Number(
      db.get('SELECT COUNT(*) AS total FROM energy_logs WHERE user_id = ?', [userId]).total
    );
    db.run('DELETE FROM energy_logs WHERE user_id = ?', [userId]);
    return { deleted: total };
  }

  function state(userId) {
    return {
      enabled: isEnabled(userId),
      levels: NIVEIS_DE_ENERGIA,
      contexts: CONTEXTOS,
      insights: insights(userId),
      heatmap: heatmap(userId)
    };
  }

  return { heatmap, insights, isEnabled, log, purge, recent, remove, setEnabled, state };
}
