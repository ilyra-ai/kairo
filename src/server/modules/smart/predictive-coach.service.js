// ============================================================================
// Kairo — Coach Preditivo Proativo (Tarefa 35.8)
// ----------------------------------------------------------------------------
// Analisa os dados REAIS do usuário (agenda concluída/não concluída, carga
// cognitiva por dia e por faixa horária) numa janela configurável e detecta
// padrões de risco: procrastinação, sobrecarga recorrente e horários
// improdutivos — sugerindo ajustes proativos. Determinístico; a IA é opcional
// (personaliza a mensagem em outra camada). Nunca inventa dados.
// ============================================================================

const FEATURE_KEY = 'predictive_coach';
// Amostra mínima de eventos numa faixa horária para considerá-la significativa.
const MIN_AMOSTRA_FAIXA = 3;

export function createPredictiveCoachService({
  db,
  smartFeaturesService,
  now = () => new Date()
} = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('O coach preditivo exige banco de dados e a governança inteligente.');
  }

  function dataDeHoje() {
    return now().toISOString().slice(0, 10);
  }

  function subtrairDias(dataIso, dias) {
    const d = new Date(`${dataIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - dias);
    return d.toISOString().slice(0, 10);
  }

  function severidade(valor, media, alta) {
    if (valor >= alta) return 'alta';
    if (valor >= media) return 'media';
    return 'baixa';
  }

  // Produz insights acionáveis a partir do histórico real da janela.
  function analyze(userId) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const janelaDias = Math.max(1, Math.min(90, Number(params.janela_dias) || 14));
    const limiarProcrastinacao = Number(params.limiar_procrastinacao) || 0.5;
    // Orçamento diário de energia reaproveitado da governança (fonte única).
    const energiaParams = smartFeaturesService.params('energy_budget') || {};
    const orcamentoDia = Number(energiaParams.orcamento_base) || 12;
    const pesos = {
      1: Number(energiaParams.peso_leve) || 1,
      2: Number(energiaParams.peso_media) || 2,
      3: Number(energiaParams.peso_intensa) || 3
    };

    const hoje = dataDeHoje();
    const inicio = subtrairDias(hoje, janelaDias);

    const eventos = db.all(
      `SELECT event_date, start_time, cognitive_load, is_completed
         FROM agenda_events
        WHERE user_id = ? AND event_date BETWEEN ? AND ?`,
      [userId, inicio, hoje]
    );

    const total = eventos.length;
    const insights = [];
    const completadas = eventos.filter((e) => e.is_completed === 1).length;
    const completionRatio = total > 0 ? Number((completadas / total).toFixed(2)) : 0;

    if (total === 0) {
      return {
        window_days: janelaDias,
        sample: 0,
        completion_ratio: 0,
        insights: [],
        message: 'Sem histórico suficiente na janela para gerar recomendações.'
      };
    }

    // 1) Procrastinação: proporção de eventos não concluídos.
    const naoConcluidas = total - completadas;
    const procrastinacaoRatio = Number((naoConcluidas / total).toFixed(2));
    if (procrastinacaoRatio >= limiarProcrastinacao) {
      insights.push({
        type: 'procrastinacao',
        severity: severidade(
          procrastinacaoRatio,
          limiarProcrastinacao,
          limiarProcrastinacao + 0.25
        ),
        metric: procrastinacaoRatio,
        message: `${Math.round(procrastinacaoRatio * 100)}% dos compromissos da janela não foram concluídos.`,
        recommendation:
          'Reduza a quantidade de blocos por dia e quebre tarefas grandes em passos menores.'
      });
    }

    // 2) Sobrecarga recorrente: dias cuja carga excede o orçamento diário.
    const cargaPorDia = new Map();
    for (const e of eventos) {
      const carga = Math.max(1, Math.min(3, Number(e.cognitive_load) || 1));
      cargaPorDia.set(e.event_date, (cargaPorDia.get(e.event_date) || 0) + pesos[carga]);
    }
    const diasSobrecarga = [...cargaPorDia.values()].filter((v) => v > orcamentoDia).length;
    const diasComEventos = cargaPorDia.size;
    if (diasSobrecarga > 0) {
      const proporcao = Number((diasSobrecarga / diasComEventos).toFixed(2));
      insights.push({
        type: 'sobrecarga',
        severity: severidade(proporcao, 0.3, 0.6),
        metric: diasSobrecarga,
        message: `${diasSobrecarga} de ${diasComEventos} dias com eventos ultrapassaram o orçamento de energia.`,
        recommendation:
          'Redistribua tarefas de alta carga cognitiva e intercale com blocos leves ou pausas.'
      });
    }

    // 3) Horário improdutivo: faixa horária com pior taxa de conclusão.
    const faixas = new Map();
    for (const e of eventos) {
      const hora = Number(String(e.start_time).slice(0, 2));
      if (!Number.isFinite(hora)) continue;
      const atual = faixas.get(hora) || { total: 0, concluidas: 0 };
      atual.total += 1;
      atual.concluidas += e.is_completed === 1 ? 1 : 0;
      faixas.set(hora, atual);
    }
    let piorFaixa = null;
    for (const [hora, dados] of faixas.entries()) {
      if (dados.total < MIN_AMOSTRA_FAIXA) continue;
      const taxaFalha = 1 - dados.concluidas / dados.total;
      if (!piorFaixa || taxaFalha > piorFaixa.taxaFalha) {
        piorFaixa = { hora, taxaFalha: Number(taxaFalha.toFixed(2)), total: dados.total };
      }
    }
    if (piorFaixa && piorFaixa.taxaFalha >= 0.5) {
      insights.push({
        type: 'horario_improdutivo',
        severity: severidade(piorFaixa.taxaFalha, 0.5, 0.75),
        metric: piorFaixa.taxaFalha,
        message: `Na faixa das ${String(piorFaixa.hora).padStart(2, '0')}h, ${Math.round(piorFaixa.taxaFalha * 100)}% dos compromissos não foram concluídos.`,
        recommendation:
          'Evite tarefas exigentes nesse horário; reserve-o para tarefas leves ou descanso.'
      });
    }

    return {
      window_days: janelaDias,
      sample: total,
      completion_ratio: completionRatio,
      insights,
      message:
        insights.length > 0
          ? 'Padrões de risco detectados — veja as recomendações.'
          : 'Nenhum padrão de risco relevante na janela. Continue assim!'
    };
  }

  return { analyze };
}
