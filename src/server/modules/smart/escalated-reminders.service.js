// ============================================================================
// Kairo — Lembretes Persistentes Escalonados (Tarefa 35.6)
// ----------------------------------------------------------------------------
// Um único lembrete costuma ser ignorado. Este engine escalona lembretes em
// níveis, com intervalos crescentes definidos pelo administrador, até o usuário
// AGIR (concluir) ou ADIAR conscientemente. Determinístico; a IA é opcional
// (ajusta tom/urgência em outra camada). Respeita o máximo de escalonamentos.
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

const FEATURE_KEY = 'persistent_reminders';

export function ensureEscalatedRemindersSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS escalated_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      ref_type TEXT,
      ref_id INTEGER,
      base_at TEXT NOT NULL,
      next_at TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
      status TEXT NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente', 'adiado', 'concluido', 'esgotado')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_escalated_reminders_due ON escalated_reminders (user_id, status, next_at);'
  );
}

// Normaliza os intervalos configurados (minutos crescentes) para um array seguro.
function normalizarIntervalos(params) {
  const bruto = Array.isArray(params.intervalos_min) ? params.intervalos_min : [5, 15, 30];
  const limpos = bruto.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n > 0);
  return limpos.length > 0 ? limpos : [5, 15, 30];
}

export function createEscalatedRemindersService({
  db,
  smartFeaturesService,
  now = () => new Date()
} = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('Os lembretes escalonados exigem banco de dados e a governança inteligente.');
  }
  ensureEscalatedRemindersSchema(db);

  function agoraIso() {
    return now().toISOString().slice(0, 19).replace('T', ' ');
  }

  function emJanelaSilenciosa() {
    const params = smartFeaturesService.params(FEATURE_KEY);
    const inicio = String(params.silencio_inicio || '').slice(0, 5);
    const fim = String(params.silencio_fim || '').slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(inicio) || !/^\d{2}:\d{2}$/.test(fim) || inicio === fim) {
      return false;
    }
    const hora = agoraIso().slice(11, 16);
    return inicio < fim ? hora >= inicio && hora < fim : hora >= inicio || hora < fim;
  }

  function validarDataHora(valor, campo) {
    const texto = String(valor || '').trim();
    // Aceita "YYYY-MM-DD HH:MM" ou "YYYY-MM-DDTHH:MM(:SS)".
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(texto)) {
      throw unprocessable(`Data/hora inválida em ${campo}.`, 'DATAHORA_INVALIDA');
    }
    const iso = texto.replace('T', ' ');
    return iso.length === 16 ? `${iso}:00` : iso;
  }

  // Cria um lembrete escalonável (nível 0 dispara no horário base).
  function schedule(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const title = String(input.title || '').trim();
    if (title.length < 1 || title.length > 200) {
      throw unprocessable('Informe o título do lembrete.', 'TITULO_INVALIDO');
    }
    const baseAt = validarDataHora(input.base_at, 'base_at');
    const refType = input.ref_type ? String(input.ref_type).trim().slice(0, 40) : null;
    const refId = Number.isInteger(input.ref_id) ? input.ref_id : null;

    const resultado = db.run(
      `INSERT INTO escalated_reminders (user_id, title, ref_type, ref_id, base_at, next_at, level, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'pendente')`,
      [userId, title, refType, refId, baseAt, baseAt]
    );
    return db.get('SELECT * FROM escalated_reminders WHERE id = ?', [resultado.lastInsertRowid]);
  }

  // Lista os lembretes vencidos (next_at <= agora) ainda ativos.
  function due(userId) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    if (emJanelaSilenciosa()) return [];
    return db.all(
      `SELECT * FROM escalated_reminders
        WHERE user_id = ? AND status IN ('pendente', 'adiado') AND next_at <= ?
        ORDER BY next_at ASC`,
      [userId, agoraIso()]
    );
  }

  function list(userId) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    return db.all(
      `SELECT * FROM escalated_reminders
        WHERE user_id = ?
        ORDER BY CASE status WHEN 'pendente' THEN 0 WHEN 'adiado' THEN 1 ELSE 2 END,
                 next_at ASC, id DESC`,
      [userId]
    );
  }

  function carregarProprio(userId, id) {
    const lembrete = db.get('SELECT * FROM escalated_reminders WHERE id = ? AND user_id = ?', [
      id,
      userId
    ]);
    if (!lembrete) throw unprocessable('Lembrete não encontrado.', 'LEMBRETE_NAO_ENCONTRADO');
    return lembrete;
  }

  // Escalona para o próximo nível; ao exceder o máximo, marca como esgotado.
  function escalate(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const intervalos = normalizarIntervalos(params);
    const maxEscalonamentos = Math.max(1, Number(params.max_escalonamentos) || 3);
    const lembrete = carregarProprio(userId, Number(input.id));
    if (lembrete.status === 'concluido' || lembrete.status === 'esgotado') {
      return lembrete;
    }

    const proximoNivel = lembrete.level + 1;
    if (proximoNivel > maxEscalonamentos) {
      db.run("UPDATE escalated_reminders SET status = 'esgotado' WHERE id = ?", [lembrete.id]);
      return carregarProprio(userId, lembrete.id);
    }

    // Intervalo do nível (usa o último intervalo se houver mais níveis que intervalos).
    const idx = Math.min(proximoNivel - 1, intervalos.length - 1);
    const minutos = intervalos[idx];
    db.run(
      `UPDATE escalated_reminders
          SET level = ?, status = 'pendente', next_at = datetime(next_at, ?)
        WHERE id = ?`,
      [proximoNivel, `+${minutos} minutes`, lembrete.id]
    );
    return carregarProprio(userId, lembrete.id);
  }

  // Ação consciente do usuário: concluir ou adiar (snooze) por N minutos.
  function act(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const lembrete = carregarProprio(userId, Number(input.id));
    const acao = input.action;
    if (acao === 'done') {
      db.run("UPDATE escalated_reminders SET status = 'concluido' WHERE id = ?", [lembrete.id]);
      return carregarProprio(userId, lembrete.id);
    }
    if (acao === 'snooze') {
      const minutos = Math.max(1, Math.min(1440, Number(input.snooze_minutes) || 10));
      db.run(
        `UPDATE escalated_reminders
            SET status = 'adiado', next_at = datetime(?, ?)
          WHERE id = ?`,
        [agoraIso(), `+${minutos} minutes`, lembrete.id]
      );
      return carregarProprio(userId, lembrete.id);
    }
    throw unprocessable('Ação inválida (use done ou snooze).', 'ACAO_INVALIDA');
  }

  function reschedule(userId, id, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const reminder = carregarProprio(userId, Number(id));
    const baseAt = validarDataHora(input.base_at, 'base_at');
    const title = input.title === undefined ? reminder.title : String(input.title).trim();
    if (title.length < 1 || title.length > 200) {
      throw unprocessable('Informe o título do lembrete.', 'TITULO_INVALIDO');
    }
    db.run(
      `UPDATE escalated_reminders
          SET title = ?, base_at = ?, next_at = ?, level = 0, status = 'pendente'
        WHERE id = ? AND user_id = ?`,
      [title, baseAt, baseAt, reminder.id, userId]
    );
    return carregarProprio(userId, reminder.id);
  }

  function remove(userId, id) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const reminder = carregarProprio(userId, Number(id));
    db.run('DELETE FROM escalated_reminders WHERE id = ? AND user_id = ?', [reminder.id, userId]);
    return { deleted: true, id: reminder.id };
  }

  return { schedule, list, due, escalate, act, reschedule, remove };
}
