// ============================================================================
// Kairo — Modo Agora (foco no presente) (Tarefa 35.7)
// ----------------------------------------------------------------------------
// Reduz a interface ao essencial do momento: a tarefa ATUAL (o evento em curso)
// e a PRÓXIMA. Determinístico, derivado da agenda real do usuário. Os parâmetros
// do administrador controlam se a próxima aparece e se a sidebar é ocultada.
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

const FEATURE_KEY = 'now_mode';

export function createNowModeService({
  db,
  smartFeaturesService,
  agendaService,
  now = () => new Date()
} = {}) {
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

  function act(userId, eventId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    if (!agendaService) {
      throw new Error('As ações do Modo Agora exigem o serviço de agenda.');
    }
    const event = agendaService.get(userId, eventId);
    if (input.action === 'complete') {
      return agendaService.updateCompletion(userId, eventId, { is_completed: true });
    }
    if (input.action === 'postpone') {
      const minutes = Math.max(5, Math.min(480, Number(input.minutes) || 15));
      const toMinutes = (value) => {
        const [hours, minute] = value.split(':').map(Number);
        return hours * 60 + minute;
      };
      const toTime = (value) =>
        `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
      const start = toMinutes(event.start_time) + minutes;
      const end = toMinutes(event.end_time) + minutes;
      if (end >= 24 * 60) {
        throw unprocessable(
          'O adiamento ultrapassaria o fim do dia. Reagende pela Agenda.',
          'ADIAMENTO_FORA_DO_DIA'
        );
      }
      return agendaService.update(userId, eventId, {
        activity_id: event.activity_id,
        title: event.title,
        description: event.description || '',
        event_date: event.event_date,
        start_time: toTime(start),
        end_time: toTime(end),
        priority: event.priority,
        cognitive_load: event.cognitive_load,
        event_color: event.event_color
      });
    }
    throw unprocessable('Ação inválida para o Modo Agora.', 'ACAO_INVALIDA');
  }

  return { current, act };
}
