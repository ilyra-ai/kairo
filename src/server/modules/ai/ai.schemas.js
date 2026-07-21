// ============================================================================
// Kairo — Contratos de validação do gateway de IA (Tarefa 15)
// ============================================================================

import { z } from 'zod';
import { PROVIDER_TYPES } from './ai.adapters.js';

const nome = z.string().trim().min(2, 'Informe um nome para a conexão.').max(120);
const baseUrl = z
  .string()
  .trim()
  .min(1, 'Informe a URL base.')
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), 'A URL deve começar com http:// ou https://');

export const createAiConnectionSchema = z
  .object({
    name: nome,
    provider_type: z.enum(PROVIDER_TYPES),
    base_url: baseUrl,
    api_key: z.string().min(1).max(4096).optional(),
    is_local: z.boolean().optional(),
    allow_remote_host: z.boolean().optional()
  })
  .strict();

export const updateAiConnectionSchema = z
  .object({
    name: nome.optional(),
    provider_type: z.enum(PROVIDER_TYPES).optional(),
    base_url: baseUrl.optional(),
    // string preenchida substitui; null remove; ausência mantém.
    api_key: z.union([z.string().min(1).max(4096), z.null()]).optional(),
    is_local: z.boolean().optional(),
    is_active: z.boolean().optional(),
    allow_remote_host: z.boolean().optional()
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo para atualizar.');

export const aiConnectionIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

export const aiModelIdParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

export const updateAiModelSchema = z
  .object({
    display_name: z.string().trim().min(1).max(160).optional(),
    is_default: z.boolean().optional()
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo para atualizar.');

export const listModelsQuerySchema = z
  .object({ connection_id: z.coerce.number().int().positive().optional() })
  .strict();
