// ============================================================================
// Kairo — Máquina do Tempo do Foco (Tarefa 35.9)
// ----------------------------------------------------------------------------
// Simulação preditiva determinística: a partir das METAS reais (goals) e do
// RITMO real (horas concluídas na agenda), projeta se cada meta será cumprida
// dentro do horizonte e em quantos dias — e permite simular um ajuste de ritmo
// (horas extras por dia) para ver o cenário alternativo. Não altera nada; só
// projeta sobre dados reais. A IA é opcional (narra o cenário em outra camada).
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

const FEATURE_KEY = 'focus_time_machine';

export function ensureFocusTimeMachineSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS goal_projections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      assumptions_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_goal_projections_user ON goal_projections (user_id, created_at);'
  );
}

export function createFocusTimeMachineService({
  db,
  smartFeaturesService,
  now = () => new Date()
} = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('A Máquina do Tempo do Foco exige banco de dados e a governança inteligente.');
  }
  ensureFocusTimeMachineSchema(db);

  function dataDeHoje() {
    return now().toISOString().slice(0, 10);
  }

  function subtrairDias(dataIso, dias) {
    const d = new Date(`${dataIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - dias);
    return d.toISOString().slice(0, 10);
  }

  // Calcula os dias para atingir o restante da meta em um dado ritmo diário.
  function diasParaMeta(restante, ritmoDia) {
    if (restante <= 0) return 0;
    if (ritmoDia <= 0) return null; // inatingível no ritmo atual
    return Math.ceil(restante / ritmoDia);
  }

  // Projeta o cumprimento das metas no ritmo atual e num cenário ajustado.
  function project(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const horizonteDias = Math.max(1, Math.min(365, Number(params.horizonte_dias) || 30));
    const extraHoras = Math.max(0, Math.min(24, Number(input.extra_hours_per_day) || 0));
    const janelaRitmo = Math.max(
      1,
      Math.min(90, Number(input.rhythm_window_days) || horizonteDias)
    );

    const hoje = dataDeHoje();
    const inicioRitmo = subtrairDias(hoje, janelaRitmo);

    // Metas do usuário (join com activities para respeitar o tenant).
    const metas = db.all(
      `SELECT g.id AS goal_id, g.activity_id, g.type, g.target_hours, a.title
         FROM goals g
         JOIN activities a ON a.id = g.activity_id
        WHERE a.user_id = ? AND g.target_hours > 0
        ORDER BY a.title ASC`,
      [userId]
    );

    if (metas.length === 0) {
      return {
        horizon_days: horizonteDias,
        rhythm_window_days: janelaRitmo,
        extra_hours_per_day: extraHoras,
        projections: [],
        message: 'Defina metas de horas nas atividades para simular o futuro do seu foco.'
      };
    }

    // Horas concluídas por atividade na janela (ritmo real).
    const horasPorAtividade = new Map();
    for (const linha of db.all(
      `SELECT activity_id, SUM(duration_hours) AS horas
         FROM agenda_events
        WHERE user_id = ? AND is_completed = 1 AND event_date BETWEEN ? AND ?
        GROUP BY activity_id`,
      [userId, inicioRitmo, hoje]
    )) {
      horasPorAtividade.set(linha.activity_id, Number(linha.horas) || 0);
    }

    // Progresso atual do período (timeframes.current), quando existir.
    const progressoPorChave = new Map();
    for (const linha of db.all(
      `SELECT t.activity_id, t.type, t.current
         FROM timeframes t
         JOIN activities a ON a.id = t.activity_id
        WHERE a.user_id = ?`,
      [userId]
    )) {
      progressoPorChave.set(`${linha.activity_id}:${linha.type}`, Number(linha.current) || 0);
    }

    const projections = metas.map((meta) => {
      const horasJanela = horasPorAtividade.get(meta.activity_id) || 0;
      const ritmoDia = Number((horasJanela / janelaRitmo).toFixed(3));
      const progresso = progressoPorChave.get(`${meta.activity_id}:${meta.type}`) || 0;
      const restante = Math.max(0, meta.target_hours - progresso);

      const diasAtual = diasParaMeta(restante, ritmoDia);
      const diasAjustado = diasParaMeta(restante, ritmoDia + extraHoras);

      return {
        activity_id: meta.activity_id,
        title: meta.title,
        goal_type: meta.type,
        target_hours: meta.target_hours,
        current_progress_hours: progresso,
        remaining_hours: Number(restante.toFixed(2)),
        daily_rate_hours: ritmoDia,
        days_to_goal: diasAtual,
        within_horizon: diasAtual !== null && diasAtual <= horizonteDias,
        adjusted: {
          extra_hours_per_day: extraHoras,
          daily_rate_hours: Number((ritmoDia + extraHoras).toFixed(3)),
          days_to_goal: diasAjustado,
          within_horizon: diasAjustado !== null && diasAjustado <= horizonteDias
        }
      };
    });

    const noPrazo = projections.filter((p) => p.within_horizon).length;
    return {
      horizon_days: horizonteDias,
      rhythm_window_days: janelaRitmo,
      extra_hours_per_day: extraHoras,
      projections,
      on_track: noPrazo,
      at_risk: projections.length - noPrazo,
      message:
        projections.length - noPrazo > 0
          ? `${projections.length - noPrazo} meta(s) fora do horizonte no ritmo atual — simule um ajuste de ritmo.`
          : 'Todas as metas dentro do horizonte no ritmo atual.'
    };
  }

  // Guarda de sanidade para entradas numéricas fora de faixa (defensivo).
  function validarEntrada(input = {}) {
    if (
      input.extra_hours_per_day !== undefined &&
      !Number.isFinite(Number(input.extra_hours_per_day))
    ) {
      throw unprocessable('extra_hours_per_day inválido.', 'ENTRADA_INVALIDA');
    }
    return input;
  }

  return {
    project(userId, input) {
      return project(userId, validarEntrada(input));
    },
    simulate(userId, input) {
      const assumptions = validarEntrada(input);
      const result = project(userId, assumptions);
      const inserted = db.run(
        `INSERT INTO goal_projections (user_id, assumptions_json, result_json)
         VALUES (?, ?, ?)`,
        [userId, JSON.stringify(assumptions), JSON.stringify(result)]
      );
      return { ...result, projection_id: inserted.lastInsertRowid };
    }
  };
}
