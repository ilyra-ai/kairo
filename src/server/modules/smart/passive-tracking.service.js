// ============================================================================
// Kairo — Rastreamento Passivo Inteligente (Tarefa 35.3)
// ----------------------------------------------------------------------------
// Detecta padrões de uso do PRÓPRIO app (seções visitadas, tempo de foco por
// layout) e sugere lançar como atividade — NUNCA lança sem consentimento. Tudo
// é processado localmente; respeita granularidade, retenção e os coletores
// habilitados pelo administrador na governança (smart_features).
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

const FEATURE_KEY = 'passive_tracking';
// Duração mínima (segundos) para uma seção virar sugestão de atividade.
const LIMIAR_SUGESTAO_SEG = 300;

export function ensurePassiveTrackingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS passive_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      section TEXT NOT NULL,
      layout TEXT,
      focus_seconds INTEGER NOT NULL DEFAULT 0 CHECK (focus_seconds >= 0),
      focused INTEGER NOT NULL DEFAULT 1 CHECK (focused IN (0, 1)),
      occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_passive_sessions_user_date ON passive_sessions (user_id, occurred_at);'
  );
}

export function createPassiveTrackingService({
  db,
  smartFeaturesService,
  activitiesService,
  now = () => new Date()
} = {}) {
  if (!db || !smartFeaturesService || !activitiesService) {
    throw new Error('O rastreamento passivo exige banco, governança e atividades.');
  }
  ensurePassiveTrackingSchema(db);

  function dataDeHoje() {
    return now().toISOString().slice(0, 10);
  }

  // Remove sessões além da janela de retenção configurada pelo administrador.
  function purgar(userId, retencaoDias) {
    const dias = Number(retencaoDias) || 30;
    db.run("DELETE FROM passive_sessions WHERE user_id = ? AND occurred_at < datetime('now', ?)", [
      userId,
      `-${dias} days`
    ]);
  }

  // Registra uma sessão de uso, respeitando os coletores habilitados. Retorna o
  // que efetivamente foi persistido (transparência total ao usuário).
  function record(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const coletarSecoes = params.coletar_secoes !== false;
    const coletarFoco = params.coletar_foco !== false;
    if (!coletarSecoes) {
      return { recorded: false, reason: 'Coleta de seções desabilitada pelo administrador.' };
    }

    const section = String(input.section || '').trim();
    if (section.length < 1 || section.length > 80) {
      throw unprocessable('Informe a seção do app.', 'SECAO_INVALIDA');
    }
    const layout = input.layout ? String(input.layout).trim().slice(0, 80) : null;
    const focoBruto = Number(input.focus_seconds);
    const focusSeconds =
      coletarFoco && Number.isFinite(focoBruto) && focoBruto >= 0
        ? Math.min(Math.floor(focoBruto), 86400)
        : 0;
    const focused = input.focused === false ? 0 : 1;

    db.run(
      'INSERT INTO passive_sessions (user_id, section, layout, focus_seconds, focused) VALUES (?, ?, ?, ?, ?)',
      [userId, section, layout, focusSeconds, focused]
    );
    purgar(userId, params.retencao_dias);
    return {
      recorded: true,
      section,
      layout,
      focus_seconds: focusSeconds,
      focused: Boolean(focused)
    };
  }

  // Agrega os padrões do dia e propõe sugestões (não cria nada).
  function summary(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const date = input.date || dataDeHoje();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw unprocessable('Data inválida (use YYYY-MM-DD).', 'DATA_INVALIDA');
    }
    const linhas = db.all(
      `SELECT section,
              COUNT(*) AS visits,
              SUM(focus_seconds) AS total_focus,
              SUM(focused) AS focused_visits
         FROM passive_sessions
        WHERE user_id = ? AND date(occurred_at) = ?
        GROUP BY section
        ORDER BY total_focus DESC`,
      [userId, date]
    );

    const sections = linhas.map((l) => ({
      section: l.section,
      visits: l.visits,
      focus_minutes: Math.round((l.total_focus || 0) / 60),
      focus_ratio: l.visits > 0 ? Number((l.focused_visits / l.visits).toFixed(2)) : 0
    }));

    // Sugere lançar como atividade seções com foco relevante — sempre opcional.
    const suggestions = sections
      .filter((s) => s.focus_minutes * 60 >= LIMIAR_SUGESTAO_SEG)
      .map((s) => ({
        section: s.section,
        suggested_title: `Trabalho em ${s.section}`,
        focus_minutes: s.focus_minutes
      }));

    return { date, sections, suggestions };
  }

  // Promove uma sugestão a atividade REAL — só com ação explícita do usuário.
  function promote(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const titulo = String(input.title || '').trim();
    if (titulo.length < 1) throw unprocessable('Informe o título da atividade.', 'TITULO_INVALIDO');
    const atividade = activitiesService.create(userId, { title: titulo });
    return { created: true, activity: atividade };
  }

  return { record, summary, promote };
}
