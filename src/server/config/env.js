// ============================================================================
// Kairo — Configuração validada por ambiente
// ============================================================================

import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { DATABASE_FILE, ENV_FILE, PROJECT_ROOT } from './paths.js';
import { loadEncryptionKey, loadSessionSecret } from '../security/crypto.js';

const dotenvResult = dotenv.config({
  path: ENV_FILE,
  encoding: 'utf8',
  override: false,
  quiet: true
});

if (dotenvResult.error && dotenvResult.error.code !== 'ENOENT') {
  throw new Error('Não foi possível carregar o arquivo de configuração .env.', {
    cause: dotenvResult.error
  });
}

const booleanFromEnvironment = z.union([
  z.boolean(),
  z.stringbool({
    truthy: ['true', '1', 'yes', 'on', 'sim'],
    falsy: ['false', '0', 'no', 'off', 'nao', 'não']
  })
]);

const byteLimit = z
  .string()
  .trim()
  .regex(
    /^\d+(?:\.\d+)?(?:b|kb|mb)$/i,
    'Use um limite em bytes, KB ou MB, por exemplo: 512kb ou 1mb.'
  )
  .transform((value) => value.toLowerCase());

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional()
);

const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .toLowerCase()
    .email('Informe um e-mail válido para o proprietário da migração.')
    .max(254, 'O e-mail do proprietário da migração deve ter no máximo 254 caracteres.')
    .optional()
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .url('Informe uma URL absoluta válida.')
    .refine(
      (value) => ['http:', 'https:'].includes(new URL(value).protocol),
      'A URL precisa usar o protocolo HTTP ou HTTPS.'
    )
    .optional()
);

const corsOrigins = z.string().transform((value, context) => {
  const candidates = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const uniqueOrigins = [];
  for (const candidate of candidates) {
    if (candidate === '*') {
      context.addIssue({
        code: 'custom',
        message: 'CORS_ORIGINS não pode liberar todas as origens com "*".'
      });
      continue;
    }

    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || candidate !== parsed.origin) {
        throw new Error('Origem não canônica.');
      }
      if (!uniqueOrigins.includes(parsed.origin)) uniqueOrigins.push(parsed.origin);
    } catch {
      context.addIssue({
        code: 'custom',
        message: `A origem CORS "${candidate}" é inválida. Informe apenas protocolo, host e porta.`
      });
    }
  }

  return uniqueOrigins;
});

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().trim().min(1, 'HOST não pode ficar vazio.').default('127.0.0.1'),
    PORT: z.coerce
      .number()
      .int('PORT precisa ser um número inteiro.')
      .min(1, 'PORT precisa ser maior que zero.')
      .max(65535, 'PORT precisa ser menor ou igual a 65535.')
      .default(3000),
    CORS_ORIGINS: corsOrigins,
    TRUST_PROXY: booleanFromEnvironment.default(false),
    COOKIE_NAME: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]+$/, 'COOKIE_NAME contém caracteres inválidos.')
      .default('kairo.session'),
    COOKIE_SECURE: booleanFromEnvironment,
    COOKIE_HTTP_ONLY: booleanFromEnvironment.default(true),
    COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
    COOKIE_DOMAIN: optionalTrimmedString,
    SESSION_TTL_SECONDS: z.coerce
      .number()
      .int('SESSION_TTL_SECONDS precisa ser um número inteiro.')
      .min(300, 'A sessão precisa durar pelo menos 300 segundos.')
      .max(2_592_000, 'A sessão não pode ultrapassar 30 dias.')
      .default(28_800),
    JSON_BODY_LIMIT: byteLimit.default('1mb'),
    URLENCODED_BODY_LIMIT: byteLimit.default('256kb'),
    AVATAR_BODY_LIMIT: byteLimit.default('3mb'),
    SESSION_SECRET: optionalTrimmedString,
    ENCRYPTION_KEY: optionalTrimmedString,
    KAIRO_DB_PATH: optionalTrimmedString,
    MIGRATION_OWNER_EMAIL: optionalEmail,
    GOOGLE_CLIENT_ID: optionalTrimmedString,
    GOOGLE_CLIENT_SECRET: optionalTrimmedString,
    GOOGLE_REDIRECT_URI: optionalUrl,
    GOOGLE_CALENDAR_ID: z.string().trim().min(1).default('primary'),
    GOOGLE_CALENDAR_TIMEZONE: z.string().trim().min(1).default('America/Sao_Paulo')
  })
  .superRefine((configuration, context) => {
    if (configuration.COOKIE_SAME_SITE === 'none' && !configuration.COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE precisa ser true quando COOKIE_SAME_SITE for none.'
      });
    }

    if (!configuration.COOKIE_HTTP_ONLY) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_HTTP_ONLY'],
        message: 'COOKIE_HTTP_ONLY não pode ser desativado para o cookie de sessão.'
      });
    }
  });

function formatValidationErrors(issues) {
  return issues
    .map((issue) => `${issue.path.join('.') || 'configuração'}: ${issue.message}`)
    .join('; ');
}

function resolveDatabasePath(configuredPath) {
  if (!configuredPath) return DATABASE_FILE;
  return path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(PROJECT_ROOT, configuredPath);
}

/**
 * Valida as variáveis e materializa os segredos sem consultar o banco de dados.
 * `overrides` existe para testes e inicializações controladas, sem alterar process.env.
 */
export function loadEnvironment(overrides = {}) {
  const rawConfiguration = {
    ...process.env,
    ...overrides
  };

  const defaultPort = rawConfiguration.PORT || 3000;
  const defaultNodeEnvironment = rawConfiguration.NODE_ENV || 'development';

  if (rawConfiguration.CORS_ORIGINS === undefined) {
    rawConfiguration.CORS_ORIGINS =
      defaultNodeEnvironment === 'production'
        ? ''
        : `http://127.0.0.1:${defaultPort},http://localhost:${defaultPort}`;
  }

  if (rawConfiguration.COOKIE_SECURE === undefined) {
    rawConfiguration.COOKIE_SECURE = defaultNodeEnvironment === 'production' ? 'true' : 'false';
  }

  const result = environmentSchema.safeParse(rawConfiguration);
  if (!result.success) {
    throw new Error(
      `Configuração de ambiente inválida: ${formatValidationErrors(result.error.issues)}`
    );
  }

  const values = result.data;
  const sessionSecret = loadSessionSecret({ value: values.SESSION_SECRET });
  const encryptionKey = loadEncryptionKey({ value: values.ENCRYPTION_KEY });

  return Object.freeze({
    nodeEnv: values.NODE_ENV,
    isProduction: values.NODE_ENV === 'production',
    isTest: values.NODE_ENV === 'test',
    host: values.HOST,
    port: values.PORT,
    corsOrigins: Object.freeze([...values.CORS_ORIGINS]),
    trustProxy: values.TRUST_PROXY,
    databasePath: resolveDatabasePath(values.KAIRO_DB_PATH),
    migrationOwnerEmail: values.MIGRATION_OWNER_EMAIL,
    sessionSecret,
    encryptionKey,
    sessionTtlSeconds: values.SESSION_TTL_SECONDS,
    cookie: Object.freeze({
      name: values.COOKIE_NAME,
      secure: values.COOKIE_SECURE,
      httpOnly: values.COOKIE_HTTP_ONLY,
      sameSite: values.COOKIE_SAME_SITE,
      domain: values.COOKIE_DOMAIN
    }),
    limits: Object.freeze({
      json: values.JSON_BODY_LIMIT,
      urlencoded: values.URLENCODED_BODY_LIMIT,
      avatar: values.AVATAR_BODY_LIMIT
    }),
    google: Object.freeze({
      clientId: values.GOOGLE_CLIENT_ID,
      clientSecret: values.GOOGLE_CLIENT_SECRET,
      redirectUri: values.GOOGLE_REDIRECT_URI,
      calendarId: values.GOOGLE_CALENDAR_ID,
      timezone: values.GOOGLE_CALENDAR_TIMEZONE
    }),
    // Administrador padrão semeado a cada inicialização (configurável por ambiente,
    // com o padrão solicitado: admin@admin.com / admin123, perfil administrador).
    seedAdmin: Object.freeze({
      enabled: process.env.SEED_ADMIN_ENABLED !== 'false',
      name: process.env.SEED_ADMIN_NAME || 'Administrador',
      email: process.env.SEED_ADMIN_EMAIL || 'admin@admin.com',
      password: process.env.SEED_ADMIN_PASSWORD || 'admin123'
    })
  });
}

export const env = loadEnvironment();
