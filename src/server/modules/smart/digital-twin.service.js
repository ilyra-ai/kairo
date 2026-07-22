// ============================================================================
// Kairo — Gêmeo Digital de Produtividade (Tarefa 35.10)
// ----------------------------------------------------------------------------
// Constrói um MODELO do usuário a partir dos próprios dados reais (ritmo médio,
// taxa de conclusão, distribuição de carga cognitiva, melhores/piores horários
// e capacidade diária estimada) e permite SIMULAR um conjunto de tarefas antes
// de decidir — estimando se cabe na capacidade e a probabilidade de conclusão.
// Determinístico; a IA é opcional. Exige uma amostra mínima de dias reais.
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

const FEATURE_KEY = 'digital_twin';
const MIN_AMOSTRA_FAIXA = 3;

export function createDigitalTwinService({ db, smartFeaturesService } = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('O Gêmeo Digital exige banco de dados e a governança inteligente.');
  }

  // Constrói o modelo do usuário a partir de todo o histórico de agenda.
  function profile(userId) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const amostraMinima = Math.max(1, Number(params.amostra_minima_dias) || 7);

    const eventos = db.all(
      `SELECT event_date, start_time, duration_hours, cognitive_load, is_completed
         FROM agenda_events
        WHERE user_id = ?`,
      [userId]
    );

    const diasComDados = new Set(eventos.map((e) => e.event_date)).size;
    if (diasComDados < amostraMinima) {
      return {
        sufficient: false,
        days_with_data: diasComDados,
        min_days_required: amostraMinima,
        message: `Amostra insuficiente: ${diasComDados}/${amostraMinima} dias. Continue registrando para calibrar seu gêmeo digital.`
      };
    }

    const total = eventos.length;
    const concluidas = eventos.filter((e) => e.is_completed === 1).length;
    const completionRate = total > 0 ? Number((concluidas / total).toFixed(2)) : 0;

    // Horas concluídas por dia -> capacidade diária estimada (média dos dias ativos).
    const horasConcluidasPorDia = new Map();
    for (const e of eventos) {
      if (e.is_completed !== 1) continue;
      horasConcluidasPorDia.set(
        e.event_date,
        (horasConcluidasPorDia.get(e.event_date) || 0) + Number(e.duration_hours || 0)
      );
    }
    const diasAtivos = horasConcluidasPorDia.size;
    const somaHorasConcluidas = [...horasConcluidasPorDia.values()].reduce((a, b) => a + b, 0);
    const capacidadeDia =
      diasAtivos > 0 ? Number((somaHorasConcluidas / diasAtivos).toFixed(2)) : 0;

    // Distribuição da carga cognitiva.
    const distribuicao = { leve: 0, media: 0, intensa: 0 };
    for (const e of eventos) {
      const carga = Math.max(1, Math.min(3, Number(e.cognitive_load) || 1));
      if (carga === 1) distribuicao.leve += 1;
      else if (carga === 2) distribuicao.media += 1;
      else distribuicao.intensa += 1;
    }

    // Melhor e pior faixa horária por taxa de conclusão (com amostra mínima).
    const faixas = new Map();
    for (const e of eventos) {
      const hora = Number(String(e.start_time).slice(0, 2));
      if (!Number.isFinite(hora)) continue;
      const atual = faixas.get(hora) || { total: 0, concluidas: 0 };
      atual.total += 1;
      atual.concluidas += e.is_completed === 1 ? 1 : 0;
      faixas.set(hora, atual);
    }
    let best = null;
    let worst = null;
    for (const [hora, d] of faixas.entries()) {
      if (d.total < MIN_AMOSTRA_FAIXA) continue;
      const taxa = Number((d.concluidas / d.total).toFixed(2));
      if (!best || taxa > best.rate) best = { hour: hora, rate: taxa };
      if (!worst || taxa < worst.rate) worst = { hour: hora, rate: taxa };
    }

    return {
      sufficient: true,
      days_with_data: diasComDados,
      active_days: diasAtivos,
      sample_events: total,
      completion_rate: completionRate,
      estimated_daily_capacity_hours: capacidadeDia,
      load_distribution: distribuicao,
      best_hour: best,
      worst_hour: worst
    };
  }

  // Simula um conjunto de tarefas contra o modelo do usuário.
  function simulate(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const tarefas = Array.isArray(input.tasks) ? input.tasks : [];
    if (tarefas.length === 0) {
      throw unprocessable('Informe as tarefas a simular.', 'SEM_TAREFAS');
    }
    const modelo = profile(userId);
    if (!modelo.sufficient) {
      return { sufficient: false, ...modelo };
    }

    const totalHoras = tarefas.reduce((soma, t) => soma + (Number(t.hours) || 0), 0);
    const capacidade = modelo.estimated_daily_capacity_hours;
    const cabe = capacidade > 0 ? totalHoras <= capacidade : false;

    // Probabilidade base = taxa de conclusão do usuário; penaliza excesso de carga.
    let probabilidade = modelo.completion_rate;
    if (capacidade > 0 && totalHoras > capacidade) {
      probabilidade = Number((probabilidade * (capacidade / totalHoras)).toFixed(2));
    }

    const perTask = tarefas.map((t) => ({
      title: t.title ? String(t.title).slice(0, 200) : null,
      hours: Number(t.hours) || 0,
      cognitive_load: Math.max(1, Math.min(3, Number(t.cognitive_load) || 1))
    }));

    return {
      sufficient: true,
      total_hours: Number(totalHoras.toFixed(2)),
      estimated_capacity_hours: capacidade,
      fits_capacity: cabe,
      estimated_completion_probability: probabilidade,
      per_task: perTask,
      recommendation: cabe
        ? 'O conjunto cabe na sua capacidade típica — bom plano.'
        : 'O conjunto excede sua capacidade típica; considere remover ou adiar tarefas.'
    };
  }

  return { profile, simulate };
}
