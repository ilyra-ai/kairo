// ============================================================================
// Kairo — Contratos de entrada de autenticação e gestão de usuários
// ============================================================================

import { z } from 'zod';

const nome = z
  .string()
  .trim()
  .min(2, 'Informe um nome com pelo menos 2 caracteres.')
  .max(100, 'O nome deve ter no máximo 100 caracteres.');

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Informe um e-mail válido.')
  .max(254, 'O e-mail deve ter no máximo 254 caracteres.');

// Política de senha definida pelo produto: mínimo de 8 caracteres, sem exigir
// letra maiúscula, número ou caractere especial. O comprimento máximo é
// preservado para proteger o custo de hash do bcrypt.
const senhaForte = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres.')
  .max(128, 'A senha deve ter no máximo 128 caracteres.');

const senhaLogin = z
  .string()
  .min(1, 'Informe a senha.')
  .max(128, 'A senha deve ter no máximo 128 caracteres.');

const plano = z
  .string()
  .trim()
  .min(1, 'Informe o plano.')
  .max(40, 'A chave do plano deve ter no máximo 40 caracteres.')
  .regex(/^[a-z][a-z0-9_-]*$/, 'A chave do plano possui formato inválido.');

export const registerSchema = z
  .object({
    name: nome,
    email,
    password: senhaForte
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: senhaLogin
  })
  .strict();

export const reauthenticateSchema = z
  .object({
    password: senhaLogin
  })
  .strict();

export const userIdParamsSchema = z
  .object({
    id: z.coerce
      .number()
      .int('O identificador deve ser inteiro.')
      .positive('O identificador deve ser positivo.')
  })
  .strict();

export const createUserSchema = z
  .object({
    name: nome,
    email,
    password: senhaForte,
    role: z.enum(['administrador', 'usuario']).default('usuario'),
    plan: plano.default('free')
  })
  .strict();

export const updateUserSchema = z
  .object({
    name: nome.optional(),
    email: email.optional(),
    password: senhaForte.optional(),
    role: z.enum(['administrador', 'usuario']).optional(),
    plan: plano.optional(),
    is_active: z.boolean().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para atualização.'
  });

export const bootstrapStatusSchema = z.object({}).strict();
