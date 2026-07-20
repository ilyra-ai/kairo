// ============================================================================
// Kairo — Contratos de atividades, períodos e metas
// ============================================================================

import { z } from 'zod';

const id = z.coerce
  .number()
  .int('O identificador deve ser inteiro.')
  .positive('O identificador deve ser positivo.');
const timeframe = z.enum(['daily', 'weekly', 'monthly']);
const hours = z.coerce
  .number()
  .finite('As horas precisam ser numéricas.')
  .min(0, 'As horas não podem ser negativas.')
  .max(100_000, 'O valor de horas excede o limite permitido.');

export const activityIdParamsSchema = z.object({ id }).strict();

// Cor da categoria em hexadecimal completo (#RRGGBB) e ícone como um único
// emoji/símbolo curto — ambos opcionais e validados no servidor (Tarefa 19).
const corDaCategoria = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'A cor deve estar no formato hexadecimal #RRGGBB.');

const iconeDaCategoria = z
  .string()
  .trim()
  .min(1, 'O ícone não pode ficar vazio.')
  .max(8, 'O ícone deve ter no máximo 8 caracteres.')
  .regex(/^[^<>&"'`]+$/, 'O ícone não pode conter caracteres de marcação.');

const tituloDaCategoria = z
  .string()
  .trim()
  .min(2, 'O título deve ter pelo menos 2 caracteres.')
  .max(80, 'O título deve ter no máximo 80 caracteres.');

export const createActivitySchema = z
  .object({
    title: tituloDaCategoria,
    color: corDaCategoria.optional(),
    icon: iconeDaCategoria.optional()
  })
  .strict();

export const updateActivityMetadataSchema = z
  .object({
    title: tituloDaCategoria.optional(),
    color: corDaCategoria.nullable().optional(),
    icon: iconeDaCategoria.nullable().optional()
  })
  .strict()
  .refine((valor) => Object.keys(valor).length > 0, {
    message: 'Informe pelo menos um campo para atualizar.'
  });

export const updateTimeframeSchema = z
  .object({
    timeframe,
    current: hours,
    previous: hours
  })
  .strict();

export const updateGoalSchema = z
  .object({
    timeframe,
    target_hours: hours
  })
  .strict();
