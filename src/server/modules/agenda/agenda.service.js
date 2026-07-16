// ============================================================================
// Kairo — Serviço transacional, preciso e isolado da agenda
// ============================================================================

import { notFound, unprocessable } from '../../shared/http-error.js';
import {
  createAgendaEventSchema,
  listAgendaQuerySchema,
  minutesFromTime,
  updateAgendaCompletionSchema,
  updateAgendaEventSchema
} from './agenda.schemas.js';

const EVENT_SELECT = `
  SELECT
    e.id,
    e.activity_id,
    e.title,
    e.description,
    e.event_date,
    e.start_time,
    e.end_time,
    e.duration_hours,
    e.is_completed,
    e.priority,
    e.cognitive_load,
    e.event_color,
    e.google_event_id,
    e.google_synced_at,
    e.created_at,
    a.title AS activity_title
  FROM agenda_events AS e
  JOIN activities AS a
    ON a.id = e.activity_id
   AND a.user_id = e.user_id
`;

function validationDetails(error) {
  return error.issues.map((issue) => ({
    campo: issue.path.length > 0 ? issue.path.join('.') : 'agenda',
    mensagem: issue.message
  }));
}

function parseInput(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw unprocessable(
      'Revise os dados do compromisso.',
      'AGENDA_VALIDACAO_FALHOU',
      validationDetails(result.error)
    );
  }
  return result.data;
}

function normalizePositiveId(value, field = 'identificador') {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw unprocessable(
      `O ${field} precisa ser um inteiro positivo.`,
      'IDENTIFICADOR_INVALIDO'
    );
  }
  return normalized;
}

function publicEvent(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    activity_id: Number(row.activity_id),
    duration_hours: Number(row.duration_hours),
    is_completed: Boolean(row.is_completed),
    cognitive_load: Number(row.cognitive_load)
  };
}

function isoDateFromParts(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shiftIsoDate(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day + days);
  return isoDateFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function currentDateInTimeZone(dateFormatter, now) {
  const date = now();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('O relógio da agenda retornou uma data inválida.');
  }

  const parts = Object.fromEntries(
    dateFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function periodBounds(today) {
  const [year, month, day] = today.split('-').map(Number);
  const weekdayDate = new Date(0);
  weekdayDate.setUTCHours(0, 0, 0, 0);
  weekdayDate.setUTCFullYear(year, month - 1, day);
  const weekStart = shiftIsoDate(today, -weekdayDate.getUTCDay());
  const weekEnd = shiftIsoDate(weekStart, 6);

  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    today,
    weekStart,
    weekEnd,
    monthStart: isoDateFromParts(year, month, 1),
    monthEnd: shiftIsoDate(isoDateFromParts(nextMonthYear, nextMonth, 1), -1)
  };
}

function eventDurationMinutes(event) {
  const startMinutes = minutesFromTime(event.start_time);
  const endMinutes = minutesFromTime(event.end_time);
  if (Number.isFinite(startMinutes) && Number.isFinite(endMinutes) && endMinutes > startMinutes) {
    return endMinutes - startMinutes;
  }

  const storedDuration = Number(event.duration_hours);
  return Number.isFinite(storedDuration) && storedDuration >= 0
    ? Math.round(storedDuration * 60)
    : 0;
}

export function createAgendaService(options) {
  const {
    db,
    now = () => new Date(),
    timeZone = 'America/Sao_Paulo'
  } = options ?? {};

  if (!db) throw new Error('O banco é obrigatório para o serviço de agenda.');
  if (typeof now !== 'function') throw new TypeError('O relógio da agenda precisa ser uma função.');

  let dateFormatter;
  try {
    dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch (error) {
    throw new TypeError(`O fuso horário da agenda é inválido: ${timeZone}`, { cause: error });
  }

  function ownActivity(userId, activityId) {
    const activity = db.get(
      `SELECT activities.id, activities.title
       FROM activities
       WHERE activities.id = ? AND activities.user_id = ?`,
      [activityId, userId]
    );
    if (!activity) {
      throw notFound('Atividade não encontrada.', 'ATIVIDADE_NAO_ENCONTRADA');
    }
    return activity;
  }

  function ownEvent(userId, eventId) {
    const event = db.get(
      `${EVENT_SELECT}
       WHERE e.id = ? AND e.user_id = ?`,
      [eventId, userId]
    );
    if (!event) {
      throw notFound('Compromisso não encontrado.', 'COMPROMISSO_NAO_ENCONTRADO');
    }
    return publicEvent(event);
  }

  function recalculateTimeframes(userIdValue, activityIdValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const activityId = normalizePositiveId(activityIdValue, 'identificador da atividade');
    ownActivity(userId, activityId);

    const currentDate = currentDateInTimeZone(dateFormatter, now);
    const bounds = periodBounds(currentDate);
    const events = db.all(
      `SELECT agenda_events.event_date, agenda_events.start_time,
              agenda_events.end_time, agenda_events.duration_hours
       FROM agenda_events
       WHERE agenda_events.user_id = ? AND agenda_events.activity_id = ?
         AND agenda_events.event_date BETWEEN ? AND ?`,
      [userId, activityId, bounds.monthStart < bounds.weekStart ? bounds.monthStart : bounds.weekStart,
        bounds.monthEnd > bounds.weekEnd ? bounds.monthEnd : bounds.weekEnd]
    );

    const minutes = { daily: 0, weekly: 0, monthly: 0 };
    for (const event of events) {
      const duration = eventDurationMinutes(event);
      if (event.event_date === bounds.today) minutes.daily += duration;
      if (event.event_date >= bounds.weekStart && event.event_date <= bounds.weekEnd) {
        minutes.weekly += duration;
      }
      if (event.event_date >= bounds.monthStart && event.event_date <= bounds.monthEnd) {
        minutes.monthly += duration;
      }
    }

    const totals = {};
    for (const type of ['daily', 'weekly', 'monthly']) {
      totals[type] = minutes[type] / 60;
      db.run(
        `INSERT INTO timeframes (activity_id, type, current, previous)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(activity_id, type) DO UPDATE SET current = excluded.current`,
        [activityId, type, totals[type]]
      );
    }
    return totals;
  }

  function list(userIdValue, filtersValue = {}) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const filters = parseInput(listAgendaQuerySchema, filtersValue);
    if (filters.activity_id !== undefined) ownActivity(userId, filters.activity_id);

    const clauses = ['e.user_id = ?'];
    const parameters = [userId];
    if (filters.from !== undefined) {
      clauses.push('e.event_date >= ?');
      parameters.push(filters.from);
    }
    if (filters.to !== undefined) {
      clauses.push('e.event_date <= ?');
      parameters.push(filters.to);
    }
    if (filters.activity_id !== undefined) {
      clauses.push('e.activity_id = ?');
      parameters.push(filters.activity_id);
    }
    if (filters.is_completed !== undefined) {
      clauses.push('e.is_completed = ?');
      parameters.push(filters.is_completed ? 1 : 0);
    }

    return db.all(
      `${EVENT_SELECT}
       WHERE ${clauses.join(' AND ')}
       ORDER BY e.event_date ASC, e.start_time ASC, e.id ASC`,
      parameters
    ).map(publicEvent);
  }

  function get(userIdValue, eventIdValue) {
    return ownEvent(
      normalizePositiveId(userIdValue, 'usuário'),
      normalizePositiveId(eventIdValue, 'identificador do compromisso')
    );
  }

  function listByActivity(userIdValue, activityIdValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const activityId = normalizePositiveId(activityIdValue, 'identificador da atividade');
    ownActivity(userId, activityId);
    return list(userId, { activity_id: activityId });
  }

  function create(userIdValue, inputValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const input = parseInput(createAgendaEventSchema, inputValue);
    const durationMinutes = minutesFromTime(input.end_time) - minutesFromTime(input.start_time);

    return db.transaction(() => {
      ownActivity(userId, input.activity_id);
      const result = db.run(
        `INSERT INTO agenda_events
           (user_id, activity_id, title, description, event_date, start_time, end_time,
            duration_hours, is_completed, priority, cognitive_load, event_color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          input.activity_id,
          input.title,
          input.description,
          input.event_date,
          input.start_time,
          input.end_time,
          durationMinutes / 60,
          input.is_completed ? 1 : 0,
          input.priority,
          input.cognitive_load,
          input.event_color
        ]
      );
      recalculateTimeframes(userId, input.activity_id);
      return ownEvent(userId, result.lastID);
    });
  }

  function update(userIdValue, eventIdValue, inputValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const eventId = normalizePositiveId(eventIdValue, 'identificador do compromisso');
    const input = parseInput(updateAgendaEventSchema, inputValue);
    const durationMinutes = minutesFromTime(input.end_time) - minutesFromTime(input.start_time);

    return db.transaction(() => {
      const current = ownEvent(userId, eventId);
      ownActivity(userId, input.activity_id);
      db.run(
        `UPDATE agenda_events
         SET activity_id = ?, title = ?, description = ?, event_date = ?, start_time = ?,
             end_time = ?, duration_hours = ?, is_completed = ?, priority = ?,
             cognitive_load = ?, event_color = ?
         WHERE id = ? AND user_id = ?`,
        [
          input.activity_id,
          input.title,
          input.description,
          input.event_date,
          input.start_time,
          input.end_time,
          durationMinutes / 60,
          current.is_completed ? 1 : 0,
          input.priority,
          input.cognitive_load,
          input.event_color,
          eventId,
          userId
        ]
      );

      recalculateTimeframes(userId, current.activity_id);
      if (input.activity_id !== current.activity_id) {
        recalculateTimeframes(userId, input.activity_id);
      }
      return ownEvent(userId, eventId);
    });
  }

  function updateCompletion(userIdValue, eventIdValue, inputValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const eventId = normalizePositiveId(eventIdValue, 'identificador do compromisso');
    const input = parseInput(updateAgendaCompletionSchema, inputValue);

    return db.transaction(() => {
      ownEvent(userId, eventId);
      db.run(
        `UPDATE agenda_events
         SET is_completed = ?
         WHERE id = ? AND user_id = ?`,
        [input.is_completed ? 1 : 0, eventId, userId]
      );
      return ownEvent(userId, eventId);
    });
  }

  function remove(userIdValue, eventIdValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const eventId = normalizePositiveId(eventIdValue, 'identificador do compromisso');

    return db.transaction(() => {
      const current = ownEvent(userId, eventId);
      const result = db.run(
        'DELETE FROM agenda_events WHERE id = ? AND user_id = ?',
        [eventId, userId]
      );
      if (result.changes !== 1) {
        throw notFound('Compromisso não encontrado.', 'COMPROMISSO_NAO_ENCONTRADO');
      }
      recalculateTimeframes(userId, current.activity_id);
      return current;
    });
  }

  return {
    create,
    get,
    list,
    listByActivity,
    recalculateTimeframes,
    remove,
    update,
    updateCompletion
  };
}
