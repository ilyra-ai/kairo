// ============================================================================
// Kairo — Contratos das rotas de privacidade e direitos do titular
// ============================================================================

import { z } from 'zod';
import { TIPOS_DE_SOLICITACAO } from './privacy.service.js';

// A frase de confirmação é exigida exatamente como exibida na zona de perigo,
// impedindo exclusões por clique acidental ou automação descuidada.
export const FRASE_DE_CONFIRMACAO = 'EXCLUIR MINHA CONTA';

export const deleteAccountSchema = z
  .object({
    password: z
      .string()
      .min(1, 'Informe a sua senha atual.')
      .max(128, 'A senha deve ter no máximo 128 caracteres.'),
    confirmation: z.string().refine((value) => value === FRASE_DE_CONFIRMACAO, {
      message: `Digite exatamente "${FRASE_DE_CONFIRMACAO}" para confirmar.`
    })
  })
  .strict();

export const createPrivacyRequestSchema = z
  .object({
    request_type: z.enum(TIPOS_DE_SOLICITACAO, {
      error: 'Tipo de solicitação inválido.'
    }),
    details: z
      .string()
      .trim()
      .min(5, 'Descreva a solicitação com pelo menos 5 caracteres.')
      .max(2000, 'A descrição deve ter no máximo 2000 caracteres.')
      .optional()
  })
  .strict();

export const resolvePrivacyRequestSchema = z
  .object({
    status: z.enum(['em-analise', 'atendida', 'recusada'], {
      error: 'Status de solicitação inválido.'
    }),
    result_summary: z
      .string()
      .trim()
      .min(5, 'O resumo do resultado deve ter pelo menos 5 caracteres.')
      .max(2000, 'O resumo do resultado deve ter no máximo 2000 caracteres.')
      .optional()
  })
  .strict();

export const privacyRequestIdParamsSchema = z
  .object({
    id: z.coerce.number().int().positive()
  })
  .strict();
