// ============================================================================
// Kairo — Fachada da persistência, workspaces e migrações
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqliteClient, SqliteClient } from './sqlite-client.js';
import {
  CORE_TABLES,
  TENANT_ISOLATION_MIGRATION,
  createCoreTables,
  ensureTenantIsolation,
  inspectCoreSchema,
  migrateTenantIsolation
} from './migrations/001-tenant-isolation.js';

const CURRENT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACTIVITIES_FILE = path.join(CURRENT_DIRECTORY, 'seeds', 'default-activities.json');
const TIMEFRAME_TYPES = Object.freeze(['daily', 'weekly', 'monthly']);

function readDefaultActivities() {
  return JSON.parse(fs.readFileSync(DEFAULT_ACTIVITIES_FILE, 'utf8'));
}

function normalizedNonNegativeNumber(value, context) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${context} precisa ser um número finito maior ou igual a zero.`);
  }
  return number;
}

function validateSeedActivities(activities) {
  if (!Array.isArray(activities) || activities.length === 0) {
    throw new Error('O conjunto inicial de atividades precisa conter ao menos uma atividade.');
  }

  const normalized = [];
  const titles = new Set();
  for (const [index, activity] of activities.entries()) {
    const title = String(activity?.title ?? '').trim();
    if (!title || title.length > 160) {
      throw new Error(`A atividade inicial ${index + 1} possui um título inválido.`);
    }

    const normalizedTitle = title.toLocaleLowerCase('pt-BR');
    if (titles.has(normalizedTitle)) {
      throw new Error(`A atividade inicial “${title}” está duplicada.`);
    }
    titles.add(normalizedTitle);

    const timeframes = {};
    for (const type of TIMEFRAME_TYPES) {
      const source = activity?.timeframes?.[type] ?? {};
      timeframes[type] = {
        current: normalizedNonNegativeNumber(
          source.current,
          `O valor atual de ${type} em “${title}”`
        ),
        previous: normalizedNonNegativeNumber(
          source.previous,
          `O valor anterior de ${type} em “${title}”`
        )
      };
    }

    normalized.push({ title, timeframes });
  }
  return normalized;
}

const DEFAULT_ACTIVITIES = Object.freeze(validateSeedActivities(readDefaultActivities()));

function tableExists(db, tableName) {
  return Boolean(db.get(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  ));
}

function authoritativeUser(db, user) {
  const userId = Number(user?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('Usuário inválido para inicialização do workspace.');
  }

  const persistedUser = db.get(
    `SELECT users.id, users.name, users.email
     FROM users
     WHERE users.id = ? AND users.is_active = 1`,
    [userId]
  );
  if (!persistedUser) {
    throw new Error(`O usuário ativo ${userId} não existe; o workspace não foi alterado.`);
  }
  return persistedUser;
}

function seedWorkspace(db, user, activities, { replaceProfile = false } = {}) {
  if (replaceProfile) {
    db.run('DELETE FROM profile_data WHERE profile_data.user_id = ?', [user.id]);
  }

  db.run(
    `INSERT OR IGNORE INTO profile_data
       (user_id, username, email, avatar, theme, focus_sound, enable_confetti)
     VALUES (?, ?, ?, NULL, 'escuro', 'chuva', 1)`,
    [user.id, user.name, user.email]
  );

  const existing = db.get(
    'SELECT COUNT(*) AS total FROM activities WHERE activities.user_id = ?',
    [user.id]
  );
  if (Number(existing.total) > 0) {
    return { created: false, activities: Number(existing.total) };
  }

  for (const activity of activities) {
    const result = db.run(
      'INSERT INTO activities (user_id, title) VALUES (?, ?)',
      [user.id, activity.title]
    );
    for (const type of TIMEFRAME_TYPES) {
      const timeframe = activity.timeframes[type];
      db.run(
        `INSERT INTO timeframes (activity_id, type, current, previous)
         VALUES (?, ?, ?, ?)`,
        [result.lastID, type, timeframe.current, timeframe.previous]
      );
    }
  }

  return { created: true, activities: activities.length };
}

export function openKairoDatabase(baseDirectory = process.cwd(), options = {}) {
  const filename = options.filename
    ? path.resolve(options.filename)
    : process.env.KAIRO_DB_PATH
      ? path.resolve(process.env.KAIRO_DB_PATH)
      : path.join(path.resolve(baseDirectory), 'database.sqlite');
  return openSqliteClient(filename, options.sqlite);
}

export function ensureCoreSchema(db, ownerId, options = {}) {
  return ensureTenantIsolation(db, ownerId, options);
}

export function ensureUserWorkspace(db, user, options = {}) {
  const persistedUser = authoritativeUser(db, user);
  const activities = validateSeedActivities(options.seedActivities ?? DEFAULT_ACTIVITIES);
  return db.transaction((transactionDb) => seedWorkspace(transactionDb, persistedUser, activities));
}

export function ensureAllUserWorkspaces(db, options = {}) {
  const users = db.all(
    `SELECT users.id, users.name, users.email
     FROM users
     WHERE users.is_active = 1
     ORDER BY users.id`
  );
  return users.map((user) => ({
    userId: user.id,
    ...ensureUserWorkspace(db, user, options)
  }));
}

export function resetUserWorkspace(db, user, options = {}) {
  const persistedUser = authoritativeUser(db, user);
  const activities = validateSeedActivities(options.seedActivities ?? DEFAULT_ACTIVITIES);

  return db.transaction((transactionDb) => {
    transactionDb.run('DELETE FROM activities WHERE activities.user_id = ?', [persistedUser.id]);
    transactionDb.run('DELETE FROM profile_data WHERE profile_data.user_id = ?', [persistedUser.id]);
    return seedWorkspace(transactionDb, persistedUser, activities, { replaceProfile: false });
  });
}

export function databaseSummary(db) {
  const tables = ['users', ...CORE_TABLES];
  const summary = {};
  for (const tableName of tables) {
    summary[tableName] = tableExists(db, tableName)
      ? Number(db.get(`SELECT COUNT(*) AS total FROM "${tableName}"`).total)
      : 0;
  }
  return summary;
}

export function databaseHealth(db) {
  const integrity = db.integrityCheck();
  const foreignKeys = db.foreignKeyCheck();
  const schema = inspectCoreSchema(db);
  return {
    healthy: integrity.every((item) => item.integrity_check === 'ok')
      && foreignKeys.length === 0
      && schema.valid,
    integrity,
    foreignKeys,
    schema
  };
}

export {
  CORE_TABLES,
  DEFAULT_ACTIVITIES,
  SqliteClient,
  TENANT_ISOLATION_MIGRATION,
  createCoreTables,
  inspectCoreSchema,
  migrateTenantIsolation,
  openSqliteClient
};
