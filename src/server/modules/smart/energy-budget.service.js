// ============================================================================
// Kairo — Orçamento de Energia (Tarefa 35.1)
// ----------------------------------------------------------------------------
// Gestão de CAPACIDADE (não de tempo): compara a carga cognitiva planejada do
// dia com um orçamento diário configurável pelo administrador e alerta antes da
// sobrecarga. Usa a `cognitive_load` (1..3) real dos eventos da agenda. Engine
// determinístico; a IA é opcional (explica a sobrecarga em outra camada).
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';
import { ensureEnergySchema } from '../energy/energy.service.js';

const FEATURE_KEY = 'energy_budget';
const PESO_POR_CARGA = { 1: 'peso_leve', 2: 'peso_media', 3: 'peso_intensa' };

export function ensureEnergyBudgetSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energy_budgets (
      user_id INTEGER NOT NULL,
      budget_date DATE NOT NULL,
      budget REAL NOT NULL,
      consumed REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'historico',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, budget_date)
    );
  `);
}

export function createEnergyBudgetService({
  db,
  smartFeaturesService,
  now = () => new Date()
} = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('O orçamento de energia exige banco de dados e a governança inteligente.');
  }
  ensureEnergySchema(db);
  ensureEnergyBudgetSchema(db);

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

  // Calcula o consumo de energia do dia a partir da carga cognitiva real dos
  // eventos, ponderada pelos pesos configurados pelo administrador.
  function computeDay(userId, date) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const alvo = validarData(date);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const base = Number(params.orcamento_base) || 12;
    const saved = db.get(
      'SELECT budget, source FROM energy_budgets WHERE user_id = ? AND budget_date = ?',
      [userId, alvo]
    );
    const energyHistory = db.get(
      `SELECT COUNT(*) AS samples, AVG(level) AS average
         FROM energy_logs
        WHERE user_id = ? AND logged_date >= date(?, '-30 days')`,
      [userId, alvo]
    );
    const hasHistory = Number(energyHistory?.samples) >= 8;
    const historyFactor = hasHistory
      ? Math.max(0.75, Math.min(1.25, 0.75 + (Number(energyHistory.average) - 1) / 8))
      : 1;
    const derivedBudget = Number((base * historyFactor).toFixed(2));
    const orcamento = saved?.source === 'manual' ? Number(saved.budget) : derivedBudget;
    const source =
      saved?.source === 'manual' ? 'manual' : hasHistory ? 'historico_energia' : 'padrao';
    const limiar = Number(params.limiar_alerta) || 0.9;
    const pesos = {
      1: Number(params.peso_leve) || 1,
      2: Number(params.peso_media) || 2,
      3: Number(params.peso_intensa) || 3
    };

    const eventos = db.all(
      `SELECT id, title, cognitive_load, duration_hours FROM agenda_events
       WHERE user_id = ? AND event_date = ? ORDER BY start_time ASC`,
      [userId, alvo]
    );

    let consumido = 0;
    const detalhamento = eventos.map((e) => {
      const carga = Math.max(1, Math.min(3, Number(e.cognitive_load) || 1));
      const peso = pesos[carga];
      consumido += peso;
      return {
        id: e.id,
        title: e.title,
        cognitive_load: carga,
        cognitive_label: PESO_POR_CARGA[carga].replace('peso_', ''),
        energy_cost: peso
      };
    });

    const ratio = orcamento > 0 ? consumido / orcamento : 0;
    db.run(
      `INSERT INTO energy_budgets (user_id, budget_date, budget, consumed, source)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, budget_date) DO UPDATE SET
         budget = excluded.budget,
         consumed = excluded.consumed,
         source = excluded.source,
         updated_at = datetime('now')`,
      [userId, alvo, orcamento, consumido, source]
    );
    return {
      date: alvo,
      budget: orcamento,
      consumed: consumido,
      remaining: Math.max(0, orcamento - consumido),
      ratio: Math.round(ratio * 100) / 100,
      alert_threshold: limiar,
      overloaded: ratio >= 1,
      near_limit: ratio >= limiar && ratio < 1,
      source,
      energy_samples: Number(energyHistory?.samples) || 0,
      events: detalhamento
    };
  }

  function setDailyBudget(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const date = validarData(input.date);
    const budget = Number(input.budget);
    if (!Number.isFinite(budget) || budget < 1 || budget > 100) {
      throw unprocessable('O orçamento deve estar entre 1 e 100.', 'ORCAMENTO_INVALIDO');
    }
    db.run(
      `INSERT INTO energy_budgets (user_id, budget_date, budget, consumed, source)
       VALUES (?, ?, ?, 0, 'manual')
       ON CONFLICT (user_id, budget_date) DO UPDATE SET
         budget = excluded.budget, source = 'manual', updated_at = datetime('now')`,
      [userId, date, budget]
    );
    return computeDay(userId, date);
  }

  // Verifica, ANTES de agendar, se adicionar uma carga excede o orçamento.
  function wouldOverload(userId, date, cognitiveLoad) {
    const atual = computeDay(userId, date);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const carga = Math.max(1, Math.min(3, Number(cognitiveLoad) || 1));
    const peso =
      carga === 1
        ? Number(params.peso_leve) || 1
        : carga === 2
          ? Number(params.peso_media) || 2
          : Number(params.peso_intensa) || 3;
    const novoConsumo = atual.consumed + peso;
    return {
      date: atual.date,
      budget: atual.budget,
      projected: novoConsumo,
      would_overload: novoConsumo > atual.budget,
      added_cost: peso
    };
  }

  return { computeDay, setDailyBudget, wouldOverload };
}
