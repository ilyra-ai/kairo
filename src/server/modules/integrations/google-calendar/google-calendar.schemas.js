// ============================================================================
// Kairo — Contratos HTTP da integração segura com o Google Agenda
// ============================================================================

import { z } from 'zod';

const oauthState = z
  .string()
  .trim()
  .length(43, 'O estado OAuth possui tamanho inválido.')
  .regex(/^[A-Za-z0-9_-]+$/, 'O estado OAuth possui formato inválido.');

const authorizationCode = z
  .string()
  .trim()
  .min(1, 'O código de autorização não pode ficar vazio.')
  .max(4_096, 'O código de autorização excede o tamanho permitido.');

const providerError = z
  .string()
  .trim()
  .min(1, 'O erro retornado pelo Google não pode ficar vazio.')
  .max(128, 'O identificador do erro retornado pelo Google é muito longo.');

export const googleAuthorizationBodySchema = z.object({}).strict().default({});

/**
 * O Google pode acrescentar parâmetros informativos como `scope`, `authuser`
 * e `prompt`. Eles são descartados pelo Zod, enquanto os campos de segurança
 * usados pela aplicação permanecem validados de forma estrita.
 */
export const googleCallbackQuerySchema = z
  .object({
    code: authorizationCode.optional(),
    state: oauthState,
    error: providerError.optional(),
    error_description: z.string().trim().max(1_000).optional()
  })
  .superRefine((input, context) => {
    if (!input.code && !input.error) {
      context.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'O Google não retornou um código de autorização nem um erro reconhecível.'
      });
    }
  });

export const googleSyncBodySchema = z
  .object({
    daysBefore: z.coerce
      .number()
      .int('A janela anterior precisa ser um número inteiro.')
      .min(0, 'A janela anterior não pode ser negativa.')
      .max(365, 'A janela anterior não pode ultrapassar 365 dias.')
      .default(30),
    daysAfter: z.coerce
      .number()
      .int('A janela futura precisa ser um número inteiro.')
      .min(1, 'A janela futura precisa ter ao menos um dia.')
      .max(730, 'A janela futura não pode ultrapassar 730 dias.')
      .default(180)
  })
  .strict()
  .default({});

export const googleDisconnectBodySchema = z.object({}).strict().default({});
