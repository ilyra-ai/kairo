// ============================================================================
// Kairo — Contratos de atividades, períodos e metas
// ============================================================================

import { z } from 'zod';

const id = z.coerce.number().int('O identificador deve ser inteiro.').positive('O identificador deve ser positivo.');
const timeframe = z.enum(['daily', 'weekly', 'monthly']);
const hours = z.coerce.number()
  .finite('As horas precisam ser numéricas.')
  .min(0, 'As horas não podem ser negativas.')
  .max(100_000, 'O valor de horas excede o limite permitido.');

export const activityIdParamsSchema = z.object({ id }).strict();

export const createActivitySchema = z.object({
  title: z.string()
    .trim()
    .min(2, 'O título deve ter pelo menos 2 caracteres.')
    .max(80, 'O título deve ter no máximo 80 caracteres.')
}).strict();

export const updateTimeframeSchema = z.object({
  timeframe,
  current: hours,
  previous: hours
}).strict();

export const updateGoalSchema = z.object({
  timeframe,
  target_hours: hours
}).strict();
