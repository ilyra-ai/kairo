// ============================================================================
// Kairo — Caminhos absolutos e independentes do diretório de execução
// ============================================================================

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(CONFIG_DIRECTORY, '..', '..', '..');
export const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
export const STORAGE_DIR = path.join(PROJECT_ROOT, 'storage');
export const DATABASE_DIR = path.join(STORAGE_DIR, 'database');
export const BACKUPS_DIR = path.join(STORAGE_DIR, 'backups');
export const LOGS_DIR = path.join(STORAGE_DIR, 'logs');
export const SECRETS_DIR = path.join(STORAGE_DIR, 'secrets');
export const SEED_DIR = path.join(PROJECT_ROOT, 'src', 'server', 'database', 'seeds');

export const ENV_FILE = path.join(PROJECT_ROOT, '.env');
export const DATABASE_FILE = path.join(DATABASE_DIR, 'kairo.sqlite');
export const SESSION_SECRET_FILE = path.join(SECRETS_DIR, 'session-secret.key');
export const ENCRYPTION_KEY_FILE = path.join(SECRETS_DIR, 'encryption-key.key');

export const RUNTIME_DIRECTORIES = Object.freeze([
  STORAGE_DIR,
  DATABASE_DIR,
  BACKUPS_DIR,
  LOGS_DIR,
  SECRETS_DIR
]);

/**
 * Cria somente diretórios de dados gerados em tempo de execução.
 * O diretório público e as sementes são artefatos versionados da aplicação.
 */
export async function ensureRuntimeDirectories() {
  await Promise.all(
    RUNTIME_DIRECTORIES.map((directory) => mkdir(directory, { recursive: true, mode: 0o700 }))
  );

  return Object.freeze({
    storage: STORAGE_DIR,
    database: DATABASE_DIR,
    backups: BACKUPS_DIR,
    logs: LOGS_DIR,
    secrets: SECRETS_DIR
  });
}
