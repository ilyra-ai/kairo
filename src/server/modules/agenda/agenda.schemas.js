// ============================================================================
// Kairo — Contratos seguros da agenda
// ============================================================================

import { z } from 'zod';

export const AGENDA_TITLE_MAX_LENGTH = 200;
export const AGENDA_DESCRIPTION_MAX_LENGTH = 4_000;

const positiveId = z.coerce.number()
  .int('O identificador deve ser inteiro.')
  .positive('O identificador deve ser positivo.');

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const hexadecimalColorPattern = /^#[0-9a-f]{6}$/i;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRealIsoDate(value) {
  if (!isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const daysByMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysByMonth[month - 1];
}

function minutesFromTime(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

const eventDate = z.string()
  .regex(isoDatePattern, 'A data deve usar o formato AAAA-MM-DD.')
  .refine(isRealIsoDate, 'Informe uma data de calendário válida.');

const eventTime = z.string()
  .regex(timePattern, 'O horário deve usar o formato HH:mm entre 00:00 e 23:59.');

const eventColor = z.string()
  .trim()
  .regex(hexadecimalColorPattern, 'A cor deve ser hexadecimal no formato #RRGGBB.')
  .transform((value) => value.toLowerCase())
  .nullable();

const eventFields = z.object({
  activity_id: positiveId,
  title: z.string()
    .trim()
    .min(1, 'O título é obrigatório.')
    .max(
      AGENDA_TITLE_MAX_LENGTH,
      `O título deve ter no máximo ${AGENDA_TITLE_MAX_LENGTH} caracteres.`
    ),
  description: z.string()
    .trim()
    .max(
      AGENDA_DESCRIPTION_MAX_LENGTH,
      `A descrição deve ter no máximo ${AGENDA_DESCRIPTION_MAX_LENGTH} caracteres.`
    )
    .default(''),
  event_date: eventDate,
  start_time: eventTime,
  end_time: eventTime,
  priority: z.enum(['baixa', 'media', 'alta'], {
    error: 'A prioridade deve ser baixa, media ou alta.'
  }).default('media'),
  cognitive_load: z.coerce.number()
    .int('A carga cognitiva deve ser inteira.')
    .min(1, 'A carga cognitiva mínima é 1.')
    .max(3, 'A carga cognitiva máxima é 3.')
    .default(1),
  event_color: eventColor.default(null)
}).strict().superRefine((input, context) => {
  if (minutesFromTime(input.end_time) <= minutesFromTime(input.start_time)) {
    context.addIssue({
      code: 'custom',
      path: ['end_time'],
      message: 'O horário de término deve ser posterior ao horário de início no mesmo dia.'
    });
  }
});

export const agendaIdParamsSchema = z.object({ id: positiveId }).strict();

export const agendaActivityParamsSchema = z.object({
  activity_id: positiveId
}).strict();

export const createAgendaEventSchema = eventFields.extend({
  is_completed: z.boolean().default(false)
});

export const updateAgendaEventSchema = eventFields;

export const updateAgendaCompletionSchema = z.object({
  is_completed: z.boolean()
}).strict();

const completedQuery = z.union([
  z.boolean(),
  z.enum(['true', 'false', '1', '0'])
]).transform((value) => value === true || value === 'true' || value === '1');

export const listAgendaQuerySchema = z.object({
  from: eventDate.optional(),
  to: eventDate.optional(),
  activity_id: positiveId.optional(),
  is_completed: completedQuery.optional()
}).strict().superRefine((input, context) => {
  if (input.from && input.to && input.from > input.to) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'A data final deve ser igual ou posterior à data inicial.'
    });
  }
});

export { isRealIsoDate, minutesFromTime };
