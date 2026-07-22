// ============================================================================
// Kairo — Modo Agora (foco no presente) (Tarefa 35.7)
// ----------------------------------------------------------------------------
// Reduz a interface ao essencial do momento: a tarefa ATUAL (o evento em curso)
// e a PRÓXIMA. Determinístico, derivado da agenda real do usuário. Os parâmetros
// do administrador controlam se a próxima aparece e se a sidebar é ocultada.
// ============================================================================

const FEATURE_KEY = 'now_mode';

export function createNowModeService({ db, smartFeaturesService, now = () => new Date() } = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('O Modo Agora exige banco de dados e a governança inteligente.');
  }

  function dataDeHoje() {
    return now().toISOString().slice(0, 10);
  }

  function horaAgora() {
    return now().toISOString().slice(11, 16);
  }

  // Retorna o estado do "agora": evento em curso e o próximo do dia.
  function current(userId) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const mostrarProxima = params.mostrar_proxima !== false;
    const ocultarSidebar = params.ocultar_sidebar !== false;
    const hoje = dataDeHoje();
    const hora = horaAgora();

    const atual = db.get(
      `SELECT id, title, activity_id, event_date, start_time, end_time, cognitive_load
         FROM agenda_events
        WHERE user_id = ? AND event_date = ? AND start_time <= ? AND end_time > ?
        ORDER BY start_time ASC
        LIMIT 1`,
      [userId, hoje, hora, hora]
    );

    const proxima = mostrarProxima
      ? db.get(
          `SELECT id, title, activity_id, event_date, start_time, end_time, cognitive_load
             FROM agenda_events
            WHERE user_id = ? AND event_date = ? AND start_time > ?
            ORDER BY start_time ASC
            LIMIT 1`,
          [userId, hoje, hora]
        )
      : null;

    return {
      date: hoje,
      time: hora,
      now: atual || null,
      next: proxima || null,
      show_next: mostrarProxima,
      hide_sidebar: ocultarSidebar,
      idle: !atual
    };
  }

  return { current };
}
