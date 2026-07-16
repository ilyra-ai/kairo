// ============================================================================
// Kairo — Contratos dos planos e funcionalidades
// ============================================================================

import { z } from 'zod';

const key = z
  .string()
  .trim()
  .min(2, 'A chave deve ter pelo menos 2 caracteres.')
  .max(40, 'A chave deve ter no máximo 40 caracteres.')
  .regex(/^[a-z][a-z0-9_-]*$/, 'Use apenas letras minúsculas, números, hífen e sublinhado.');

const name = z
  .string()
  .trim()
  .min(2, 'O nome deve ter pelo menos 2 caracteres.')
  .max(80, 'O nome deve ter no máximo 80 caracteres.');

const description = z.string().trim().max(500, 'A descrição deve ter no máximo 500 caracteres.');

const price = z.coerce
  .number()
  .int('O preço deve ser informado em centavos inteiros.')
  .min(0, 'O preço não pode ser negativo.')
  .max(100_000_000, 'O preço informado excede o limite permitido.');

export const planKeyParamsSchema = z.object({ key }).strict();
export const featureKeyParamsSchema = z.object({ key }).strict();

export const createPlanSchema = z
  .object({
    key,
    name,
    price,
    description: description.default('')
  })
  .strict();

export const updatePlanSchema = z
  .object({
    name: name.optional(),
    price: price.optional(),
    description: description.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para atualização.'
  });

export const createFeatureSchema = z
  .object({
    key,
    label: name
  })
  .strict();

export const toggleFeatureSchema = z
  .object({
    plan_key: key,
    feature_key: key,
    enabled: z.boolean()
  })
  .strict();
