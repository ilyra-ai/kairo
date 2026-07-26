// ============================================================================
// Kairo — Ritual de Encerramento (Tarefa 35.12)
// ----------------------------------------------------------------------------
// Fecha o dia com um ritual de shutdown (inspirado no Deep Work): revisa o que
// foi concluído, captura as pendências do dia e prepara o plano do amanhã.
// Determinístico, derivado da agenda real; o horário sugerido e o número de
// itens do amanhã vêm dos parâmetros do administrador. A IA é opcional.
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

const FEATURE_KEY = 'shutdown_ritual';

export function ensureShutdownRitualSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shutdown_rituals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ritual_date DATE NOT NULL,
      completed_count INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      tomorrow_plan TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      UNIQUE (user_id, ritual_date)
    );
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_shutdown_rituals_user ON shutdown_rituals (user_id, ritual_date);'
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS shutdown_rollovers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ritual_id INTEGER NOT NULL,
      source_event_id INTEGER NOT NULL,
      target_event_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ritual_id) REFERENCES shutdown_rituals (id) ON DELETE CASCADE,
      UNIQUE (source_event_id)
    );
  `);
}

export function createShutdownRitualService({
  db,
  smartFeaturesService,
  now = () => new Date()
} = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('O Ritual de Encerramento exige banco de dados e a governança inteligente.');
  }
  ensureShutdownRitualSchema(db);

  function dataDeHoje() {
    return now().toISOString().slice(0, 10);
  }

  function validarData(date) {
    const alvo = date || dataDeHoje();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(alvo)) {
      throw unprocessable('Data inválida (use YYYY-MM-DD).', 'DATA_INVALIDA');
    }
    return alvo;
  }

  function proximoDia(date) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
  }

  // Monta a revisão do dia e sugere o plano do amanhã (não persiste).
  function summary(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const horarioSugerido = params.horario_sugerido || '18:00';
    const itensAmanha = Math.max(1, Math.min(10, Number(params.itens_amanha) || 3));
    const date = validarData(input.date);

    const concluidos = db.all(
      `SELECT id, title, start_time, end_time, cognitive_load
         FROM agenda_events
        WHERE user_id = ? AND event_date = ? AND is_completed = 1
        ORDER BY start_time ASC`,
      [userId, date]
    );
    const pendentes = db.all(
      `SELECT id, title, start_time, end_time, cognitive_load, priority
         FROM agenda_events
        WHERE user_id = ? AND event_date = ? AND is_completed = 0
        ORDER BY
          CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
          start_time ASC`,
      [userId, date]
    );

    // Sugestão do amanhã: começa pelas pendências de maior prioridade do dia.
    const sugestoesAmanha = pendentes.slice(0, itensAmanha).map((p) => ({
      title: p.title,
      from_pending: true,
      priority: p.priority
    }));

    return {
      date,
      suggested_time: horarioSugerido,
      tomorrow_slots: itensAmanha,
      steps: Array.isArray(params.passos) ? params.passos : [],
      completed: concluidos,
      pending: pendentes,
      completed_count: concluidos.length,
      pending_count: pendentes.length,
      tomorrow_suggestions: sugestoesAmanha,
      closing_message:
        concluidos.length > 0
          ? `Você concluiu ${concluidos.length} bloco(s) hoje. Feche o dia com tranquilidade.`
          : 'Encerre o dia: registre pendências e prepare um recomeço leve amanhã.'
    };
  }

  // Registra o ritual concluído com o plano do amanhã (persistente, atualizável).
  function complete(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const itensAmanha = Math.max(1, Math.min(10, Number(params.itens_amanha) || 3));
    const date = validarData(input.date);

    const brutos = Array.isArray(input.tomorrow_items) ? input.tomorrow_items : [];
    const planoAmanha = brutos
      .map((item) => String(item || '').trim())
      .filter((item) => item.length >= 1 && item.length <= 200)
      .slice(0, itensAmanha);

    const totais = db.get(
      `SELECT
          SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS concluidos,
          SUM(CASE WHEN is_completed = 0 THEN 1 ELSE 0 END) AS pendentes
         FROM agenda_events
        WHERE user_id = ? AND event_date = ?`,
      [userId, date]
    );
    const concluidos = totais?.concluidos || 0;
    const pendentes = totais?.pendentes || 0;

    const targetDate = proximoDia(date);
    const rolled = [];
    db.transaction(() => {
      db.run(
        `INSERT INTO shutdown_rituals (user_id, ritual_date, completed_count, pending_count, tomorrow_plan)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, ritual_date)
         DO UPDATE SET completed_count = excluded.completed_count,
                       pending_count = excluded.pending_count,
                       tomorrow_plan = excluded.tomorrow_plan`,
        [userId, date, concluidos, pendentes, JSON.stringify(planoAmanha)]
      );
      const ritual = db.get(
        'SELECT id FROM shutdown_rituals WHERE user_id = ? AND ritual_date = ?',
        [userId, date]
      );
      const selected = new Set(planoAmanha.map((title) => title.toLocaleLowerCase('pt-BR')));
      const sourceEvents = db.all(
        `SELECT * FROM agenda_events
          WHERE user_id = ? AND event_date = ? AND is_completed = 0
          ORDER BY CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, start_time ASC`,
        [userId, date]
      );
      for (const source of sourceEvents) {
        if (!selected.has(String(source.title).toLocaleLowerCase('pt-BR'))) continue;
        const existing = db.get(
          'SELECT target_event_id FROM shutdown_rollovers WHERE source_event_id = ?',
          [source.id]
        );
        if (existing) {
          rolled.push(existing.target_event_id);
          continue;
        }
        const inserted = db.run(
          `INSERT INTO agenda_events
            (user_id, activity_id, title, description, event_date, start_time, end_time,
             duration_hours, is_completed, priority, cognitive_load, event_color)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          [
            userId,
            source.activity_id,
            source.title,
            source.description,
            targetDate,
            source.start_time,
            source.end_time,
            source.duration_hours,
            source.priority,
            source.cognitive_load,
            source.event_color
          ]
        );
        db.run(
          `INSERT INTO shutdown_rollovers (ritual_id, source_event_id, target_event_id)
           VALUES (?, ?, ?)`,
          [ritual.id, source.id, inserted.lastInsertRowid]
        );
        rolled.push(inserted.lastInsertRowid);
      }
    });

    const registro = db.get(
      'SELECT * FROM shutdown_rituals WHERE user_id = ? AND ritual_date = ?',
      [userId, date]
    );
    return {
      ...registro,
      tomorrow_plan: JSON.parse(registro.tomorrow_plan),
      rollover_date: targetDate,
      rolled_event_ids: rolled,
      rolled_count: rolled.length,
      closing_message:
        params.frase_encerramento ||
        'O expediente terminou. O plano de amanhã está seguro no Kairo.'
    };
  }

  // Histórico de rituais (aderência ao encerramento).
  function history(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const limite = Math.max(1, Math.min(90, Number(input.limit) || 14));
    const linhas = db.all(
      `SELECT ritual_date, completed_count, pending_count, tomorrow_plan, created_at
         FROM shutdown_rituals
        WHERE user_id = ?
        ORDER BY ritual_date DESC
        LIMIT ?`,
      [userId, limite]
    );
    return {
      count: linhas.length,
      rituals: linhas.map((l) => ({
        ...l,
        tomorrow_plan: JSON.parse(l.tomorrow_plan)
      }))
    };
  }

  return { summary, complete, history };
}
