// ============================================================================
// Kairo — Contratos públicos do motor de recompensas e Dopamenu
// ============================================================================

import { z } from 'zod';

export const DOPAMINE_GENERATOR_KEYS = Object.freeze([
  'recompensa_variavel',
  'bau_loot',
  'combo',
  'micro_conclusoes',
  'antecipacao',
  'mensagens_rpe',
  'multissensorial',
  'dopamenu',
  'surpresa'
]);

export const AI_REWARD_KEYS = Object.freeze(['nao_repetir', 'aprender_preferencias']);

export const DOPAMENU_CATEGORIES = Object.freeze(['entrada', 'principal', 'sobremesa']);

const positiveId = z.coerce
  .number()
  .int('O identificador deve ser inteiro.')
  .positive('O identificador deve ser positivo.');

const trimmedLabel = z
  .string()
  .trim()
  .min(2, 'A recompensa deve ter pelo menos 2 caracteres.')
  .max(160, 'A recompensa deve ter no máximo 160 caracteres.');

export const completionSchema = z
  .object({
    agenda_event_id: positiveId
  })
  .strict();

export const rewardFeedbackSchema = z
  .object({
    event_id: positiveId,
    rating: z.coerce
      .number()
      .int('A avaliação deve ser um número inteiro.')
      .min(1, 'A avaliação mínima é 1.')
      .max(5, 'A avaliação máxima é 5.')
  })
  .strict();

export const createDopamenuItemSchema = z
  .object({
    category: z
      .enum(DOPAMENU_CATEGORIES, {
        error: 'A categoria deve ser entrada, principal ou sobremesa.'
      })
      .default('principal'),
    label: trimmedLabel
  })
  .strict();

export const updateDopamenuItemSchema = z
  .object({
    category: z.enum(DOPAMENU_CATEGORIES, {
      error: 'A categoria deve ser entrada, principal ou sobremesa.'
    }),
    label: trimmedLabel
  })
  .strict();

export const dopamenuIdParamsSchema = z.object({ id: positiveId }).strict();

export const generatorConfigSchema = z
  .object({
    key: z.enum(DOPAMINE_GENERATOR_KEYS, {
      error: 'Gerador de dopamina inválido.'
    }),
    enabled: z.boolean()
  })
  .strict();

export const aiRewardConfigSchema = z
  .object({
    key: z.enum(AI_REWARD_KEYS, {
      error: 'Parâmetro de recompensa inteligente inválido.'
    }),
    value: z.boolean()
  })
  .strict();
