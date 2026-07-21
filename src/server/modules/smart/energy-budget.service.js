// ============================================================================
// Kairo — Orçamento de Energia (Tarefa 35.1)
// ----------------------------------------------------------------------------
// Gestão de CAPACIDADE (não de tempo): compara a carga cognitiva planejada do
// dia com um orçamento diário configurável pelo administrador e alerta antes da
// sobrecarga. Usa a `cognitive_load` (1..3) real dos eventos da agenda. Engine
// determinístico; a IA é opcional (explica a sobrecarga em outra camada).
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

const FEATURE_KEY = 'energy_budget';
const PESO_POR_CARGA = { 1: 'peso_leve', 2: 'peso_media', 3: 'peso_intensa' };

export function createEnergyBudgetService({
  db,
  smartFeaturesService,
  now = () => new Date()
} = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('O orçamento de energia exige banco de dados e a governança inteligente.');
  }

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
    const orcamento = Number(params.orcamento_base) || 12;
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
    return {
      date: alvo,
      budget: orcamento,
      consumed: consumido,
      remaining: Math.max(0, orcamento - consumido),
      ratio: Math.round(ratio * 100) / 100,
      alert_threshold: limiar,
      overloaded: ratio >= 1,
      near_limit: ratio >= limiar && ratio < 1,
      events: detalhamento
    };
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

  return { computeDay, wouldOverload };
}
