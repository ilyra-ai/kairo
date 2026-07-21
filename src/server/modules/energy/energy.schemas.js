// ============================================================================
// Kairo — Contratos do termômetro de energia (Tarefa 23)
// ============================================================================

import { z } from 'zod';
import { CONTEXTOS, NIVEIS_DE_ENERGIA } from './energy.service.js';

export const logEnergySchema = z
  .object({
    level: z.coerce
      .number()
      .int('O nível deve ser inteiro.')
      .refine((valor) => NIVEIS_DE_ENERGIA.includes(valor), 'Nível de energia inválido (1 a 5).'),
    context: z.enum(CONTEXTOS).optional()
  })
  .strict();

export const energySettingsSchema = z
  .object({
    enabled: z.boolean()
  })
  .strict();

export const energyIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();
