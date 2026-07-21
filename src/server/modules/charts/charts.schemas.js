// ============================================================================
// Kairo — Contratos do construtor de gráficos (Tarefa 21)
// ============================================================================

import { z } from 'zod';

const chave = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z_]+$/, 'Identificador inválido.');

const titulo = z
  .string()
  .trim()
  .min(1, 'Informe um título para o gráfico.')
  .max(120, 'O título deve ter no máximo 120 caracteres.');

export const createChartSchema = z
  .object({
    title: titulo,
    source: chave,
    dimension: chave,
    metric: chave,
    aggregate: chave,
    chart_type: chave
  })
  .strict();

export const updateChartSchema = z
  .object({
    title: titulo.optional(),
    source: chave.optional(),
    dimension: chave.optional(),
    metric: chave.optional(),
    aggregate: chave.optional(),
    chart_type: chave.optional()
  })
  .strict()
  .refine((valor) => Object.keys(valor).length > 0, {
    message: 'Informe pelo menos um campo para atualizar.'
  });

export const previewChartSchema = z
  .object({
    source: chave,
    dimension: chave,
    metric: chave,
    aggregate: chave,
    chart_type: chave
  })
  .strict();

export const reorderChartsSchema = z
  .object({
    order: z.array(z.coerce.number().int().positive()).min(1, 'Informe a nova ordem.')
  })
  .strict();

export const chartIdParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
