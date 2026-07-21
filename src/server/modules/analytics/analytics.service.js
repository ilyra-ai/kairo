// ============================================================================
// Kairo — Analytics temporal da agenda (Tarefa 20)
// ============================================================================
//
// Agrega, por usuário autenticado, as horas reais da agenda por data no fuso
// definido do produto (as datas de `agenda_events.event_date` já são gravadas
// como dia local pelo serviço de agenda). Oferece filtros de múltipla seleção
// por ano, mês e dia, e devolve também os valores disponíveis para montar os
// filtros dinamicamente na interface.

function normalizarLista(valores, minimo, maximo) {
  if (!Array.isArray(valores)) return [];
  const unicos = new Set();
  for (const valor of valores) {
    const numero = Number(valor);
    if (Number.isInteger(numero) && numero >= minimo && numero <= maximo) {
      unicos.add(numero);
    }
  }
  return [...unicos].sort((a, b) => a - b);
}

export function createAnalyticsService(db) {
  /**
   * Série temporal de foco do usuário.
   *
   * @param {number} userId — proprietário dos dados (isolamento obrigatório).
   * @param {{years?: number[], months?: number[], days?: number[]}} filtros —
   *   listas de múltipla seleção; vazias significam "todos".
   */
  function timeseries(userId, filtros = {}) {
    const anos = normalizarLista(filtros.years, 1970, 2999);
    const meses = normalizarLista(filtros.months, 1, 12);
    const dias = normalizarLista(filtros.days, 1, 31);

    const condicoes = ['agenda_events.user_id = ?'];
    const parametros = [userId];

    if (anos.length > 0) {
      condicoes.push(
        `CAST(strftime('%Y', agenda_events.event_date) AS INTEGER) IN (${anos
          .map(() => '?')
          .join(', ')})`
      );
      parametros.push(...anos);
    }
    if (meses.length > 0) {
      condicoes.push(
        `CAST(strftime('%m', agenda_events.event_date) AS INTEGER) IN (${meses
          .map(() => '?')
          .join(', ')})`
      );
      parametros.push(...meses);
    }
    if (dias.length > 0) {
      condicoes.push(
        `CAST(strftime('%d', agenda_events.event_date) AS INTEGER) IN (${dias
          .map(() => '?')
          .join(', ')})`
      );
      parametros.push(...dias);
    }

    const pontos = db
      .all(
        `SELECT agenda_events.event_date AS date,
                ROUND(SUM(agenda_events.duration_hours), 2) AS total_hours,
                COUNT(*) AS events,
                SUM(agenda_events.is_completed) AS completed
         FROM agenda_events
         WHERE ${condicoes.join(' AND ')}
         GROUP BY agenda_events.event_date
         ORDER BY agenda_events.event_date`,
        parametros
      )
      .map((linha) => ({
        date: linha.date,
        total_hours: Number(linha.total_hours),
        events: Number(linha.events),
        completed: Number(linha.completed)
      }));

    const disponiveis = db.all(
      `SELECT DISTINCT
              CAST(strftime('%Y', agenda_events.event_date) AS INTEGER) AS year,
              CAST(strftime('%m', agenda_events.event_date) AS INTEGER) AS month,
              CAST(strftime('%d', agenda_events.event_date) AS INTEGER) AS day
       FROM agenda_events
       WHERE agenda_events.user_id = ?
       ORDER BY year, month, day`,
      [userId]
    );

    const available = {
      years: [...new Set(disponiveis.map((linha) => linha.year))],
      months: [...new Set(disponiveis.map((linha) => linha.month))].sort((a, b) => a - b),
      days: [...new Set(disponiveis.map((linha) => linha.day))].sort((a, b) => a - b)
    };

    const totals = pontos.reduce(
      (acumulado, ponto) => ({
        hours: Math.round((acumulado.hours + ponto.total_hours) * 100) / 100,
        events: acumulado.events + ponto.events,
        completed: acumulado.completed + ponto.completed
      }),
      { hours: 0, events: 0, completed: 0 }
    );

    return {
      points: pontos,
      available,
      totals,
      filters: { years: anos, months: meses, days: dias }
    };
  }

  /**
   * Drill-down de um ponto: os compromissos reais da data, prontos para a
   * tabela editável (edição e exclusão reutilizam o CRUD real da agenda).
   */
  function drilldown(userId, dateIso) {
    return db
      .all(
        `SELECT agenda_events.id, agenda_events.title, agenda_events.event_date,
                agenda_events.start_time, agenda_events.end_time,
                agenda_events.duration_hours, agenda_events.is_completed,
                agenda_events.priority, activities.title AS activity_title
         FROM agenda_events
         INNER JOIN activities ON activities.id = agenda_events.activity_id
         WHERE agenda_events.user_id = ? AND agenda_events.event_date = ?
         ORDER BY agenda_events.start_time`,
        [userId, dateIso]
      )
      .map((linha) => ({
        id: Number(linha.id),
        title: linha.title,
        event_date: linha.event_date,
        start_time: linha.start_time,
        end_time: linha.end_time,
        duration_hours: Number(linha.duration_hours),
        is_completed: Boolean(linha.is_completed),
        priority: linha.priority,
        activity_title: linha.activity_title
      }));
  }

  return { drilldown, timeseries };
}
