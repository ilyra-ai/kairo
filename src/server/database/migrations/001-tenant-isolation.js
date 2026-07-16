// ============================================================================
// Migração 001 — isolamento multiusuário e integridade relacional
// ============================================================================

import path from 'node:path';

export const TENANT_ISOLATION_MIGRATION = '001_isolamento_multiusuario';

export const CORE_TABLES = Object.freeze([
  'activities',
  'timeframes',
  'goals',
  'profile_data',
  'agenda_events',
  'google_tokens'
]);

const CHILD_FIRST_TABLES = Object.freeze([
  'timeframes',
  'goals',
  'agenda_events',
  'google_tokens',
  'profile_data',
  'activities'
]);

const REQUIRED_COLUMNS = Object.freeze({
  activities: ['id', 'user_id', 'title', 'created_at'],
  timeframes: ['id', 'activity_id', 'type', 'current', 'previous'],
  goals: ['id', 'activity_id', 'type', 'target_hours'],
  profile_data: [
    'id', 'user_id', 'username', 'email', 'avatar', 'theme', 'focus_sound',
    'enable_confetti', 'created_at', 'updated_at'
  ],
  agenda_events: [
    'id', 'user_id', 'activity_id', 'title', 'description', 'event_date',
    'start_time', 'end_time', 'duration_hours', 'is_completed', 'priority',
    'cognitive_load', 'event_color', 'google_event_id', 'google_synced_at',
    'created_at'
  ],
  google_tokens: [
    'id', 'user_id', 'access_token', 'refresh_token', 'scope', 'token_type',
    'expiry_date', 'calendar_id', 'sync_token', 'connected_email', 'updated_at'
  ]
});

const REQUIRED_UNIQUE_KEYS = Object.freeze({
  activities: [['user_id', 'title'], ['id', 'user_id']],
  timeframes: [['activity_id', 'type']],
  goals: [['activity_id', 'type']],
  profile_data: [['user_id']],
  agenda_events: [],
  google_tokens: [['user_id']]
});

const REQUIRED_FOREIGN_KEYS = Object.freeze({
  activities: [{ table: 'users', from: ['user_id'], to: ['id'] }],
  timeframes: [{ table: 'activities', from: ['activity_id'], to: ['id'] }],
  goals: [{ table: 'activities', from: ['activity_id'], to: ['id'] }],
  profile_data: [{ table: 'users', from: ['user_id'], to: ['id'] }],
  agenda_events: [
    { table: 'users', from: ['user_id'], to: ['id'] },
    { table: 'activities', from: ['activity_id', 'user_id'], to: ['id', 'user_id'] }
  ],
  google_tokens: [{ table: 'users', from: ['user_id'], to: ['id'] }]
});

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Identificador SQLite inválido: ${identifier}`);
  }
  return `"${identifier}"`;
}

function tableExists(db, tableName) {
  return Boolean(db.get(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  ));
}

function tableColumns(db, tableName) {
  if (!tableExists(db, tableName)) return new Map();
  const rows = db.all(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return new Map(rows.map((row) => [row.name, row]));
}

function columnExpression(columns, alias, name, fallbackSql) {
  return columns.has(name)
    ? `${quoteIdentifier(alias)}.${quoteIdentifier(name)}`
    : fallbackSql;
}

function normalizeColumns(columns) {
  return columns.join('\u0000');
}

function uniqueKeys(db, tableName) {
  const indexes = db.all(`PRAGMA index_list(${quoteIdentifier(tableName)})`);
  return indexes
    .filter((index) => Number(index.unique) === 1)
    .map((index) => db.all(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name));
}

function foreignKeys(db, tableName) {
  const grouped = new Map();
  for (const row of db.all(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`)) {
    if (!grouped.has(row.id)) {
      grouped.set(row.id, { table: row.table, from: [], to: [], onDelete: row.on_delete });
    }
    const group = grouped.get(row.id);
    group.from[row.seq] = row.from;
    group.to[row.seq] = row.to;
  }
  return [...grouped.values()];
}

function formatForeignKeyViolation(violation) {
  const foreignKeyId = violation.fkid ?? '?';
  return `${violation.table || 'tabela desconhecida'}(rowid=${violation.rowid ?? '?'}, fk=${foreignKeyId})`;
}

function assertNoForeignKeyViolations(db) {
  const violations = db.foreignKeyCheck();
  if (violations.length > 0) {
    const details = violations.slice(0, 5).map(formatForeignKeyViolation).join(', ');
    throw new Error(
      `A migração foi revertida antes do commit por ${violations.length} violação(ões) de chave estrangeira: ${details}.`
    );
  }
}

function assertOwnerExists(db, ownerId) {
  const normalizedOwnerId = Number(ownerId);
  if (!Number.isSafeInteger(normalizedOwnerId) || normalizedOwnerId <= 0) {
    throw new Error('Não foi possível definir um proprietário válido para os dados legados.');
  }
  if (!tableExists(db, 'users')) {
    throw new Error('A tabela de usuários precisa existir antes da migração multiusuário.');
  }

  const owner = db.get('SELECT users.id FROM users WHERE users.id = ?', [normalizedOwnerId]);
  if (!owner) {
    throw new Error(`O proprietário ${normalizedOwnerId} não existe; nenhum dado legado foi alterado.`);
  }
  return normalizedOwnerId;
}

export function createCoreTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      UNIQUE (user_id, title),
      UNIQUE (id, user_id)
    );

    CREATE TABLE IF NOT EXISTS timeframes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly')),
      current REAL NOT NULL DEFAULT 0 CHECK (current >= 0),
      previous REAL NOT NULL DEFAULT 0 CHECK (previous >= 0),
      FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE,
      UNIQUE (activity_id, type)
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly')),
      target_hours REAL NOT NULL DEFAULT 0 CHECK (target_hours >= 0),
      FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE,
      UNIQUE (activity_id, type)
    );

    CREATE TABLE IF NOT EXISTS profile_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      username TEXT NOT NULL CHECK (length(trim(username)) BETWEEN 1 AND 120),
      email TEXT NOT NULL,
      avatar TEXT DEFAULT NULL,
      theme TEXT NOT NULL DEFAULT 'escuro' CHECK (theme IN ('escuro', 'claro')),
      focus_sound TEXT NOT NULL DEFAULT 'chuva',
      enable_confetti INTEGER NOT NULL DEFAULT 1 CHECK (enable_confetti IN (0, 1)),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agenda_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      activity_id INTEGER NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
      description TEXT NOT NULL DEFAULT '',
      event_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      duration_hours REAL NOT NULL CHECK (duration_hours >= 0),
      is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
      priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa', 'media', 'alta')),
      cognitive_load INTEGER NOT NULL DEFAULT 1 CHECK (cognitive_load BETWEEN 1 AND 3),
      event_color TEXT DEFAULT NULL,
      google_event_id TEXT DEFAULT NULL,
      google_synced_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (activity_id, user_id) REFERENCES activities (id, user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      access_token TEXT DEFAULT NULL,
      refresh_token TEXT DEFAULT NULL,
      scope TEXT DEFAULT NULL,
      token_type TEXT DEFAULT NULL,
      expiry_date INTEGER DEFAULT NULL,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      sync_token TEXT DEFAULT NULL,
      connected_email TEXT DEFAULT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_activities_user ON activities (user_id);
    CREATE INDEX IF NOT EXISTS idx_timeframes_activity ON timeframes (activity_id);
    CREATE INDEX IF NOT EXISTS idx_goals_activity ON goals (activity_id);
    CREATE INDEX IF NOT EXISTS idx_agenda_user_date
      ON agenda_events (user_id, event_date, start_time);
    CREATE INDEX IF NOT EXISTS idx_agenda_user_activity
      ON agenda_events (user_id, activity_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_google_user
      ON agenda_events (user_id, google_event_id)
      WHERE google_event_id IS NOT NULL;
  `);
}

export function inspectCoreSchema(db) {
  const issues = [];

  for (const tableName of CORE_TABLES) {
    if (!tableExists(db, tableName)) {
      issues.push(`Tabela ausente: ${tableName}`);
      continue;
    }

    const columns = tableColumns(db, tableName);
    for (const columnName of REQUIRED_COLUMNS[tableName]) {
      if (!columns.has(columnName)) {
        issues.push(`Coluna ausente: ${tableName}.${columnName}`);
      }
    }

    const existingUniqueKeys = new Set(uniqueKeys(db, tableName).map(normalizeColumns));
    for (const requiredKey of REQUIRED_UNIQUE_KEYS[tableName]) {
      if (!existingUniqueKeys.has(normalizeColumns(requiredKey))) {
        issues.push(`Restrição UNIQUE ausente: ${tableName}(${requiredKey.join(', ')})`);
      }
    }

    const existingForeignKeys = foreignKeys(db, tableName);
    for (const requiredKey of REQUIRED_FOREIGN_KEYS[tableName]) {
      const found = existingForeignKeys.some((candidate) => (
        candidate.table === requiredKey.table
        && normalizeColumns(candidate.from) === normalizeColumns(requiredKey.from)
        && normalizeColumns(candidate.to) === normalizeColumns(requiredKey.to)
        && candidate.onDelete === 'CASCADE'
      ));
      if (!found) {
        issues.push(
          `Chave estrangeira ausente: ${tableName}(${requiredKey.from.join(', ')}) -> ${requiredKey.table}(${requiredKey.to.join(', ')})`
        );
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function renameLegacyTables(db) {
  for (const tableName of CHILD_FIRST_TABLES) {
    if (!tableExists(db, tableName)) continue;
    const legacyName = `${tableName}_legacy_tenant`;
    if (tableExists(db, legacyName)) {
      throw new Error(`A migração encontrou a tabela temporária inesperada ${legacyName}.`);
    }
    db.exec(`ALTER TABLE ${quoteIdentifier(tableName)} RENAME TO ${quoteIdentifier(legacyName)}`);
  }
}

function copyLegacyActivities(db, ownerId) {
  const tableName = 'activities_legacy_tenant';
  if (!tableExists(db, tableName)) return;
  const columns = tableColumns(db, tableName);
  const userId = columnExpression(columns, 'a', 'user_id', '@ownerId');
  const title = columnExpression(columns, 'a', 'title', "'Atividade migrada ' || a.id");
  const createdAt = columnExpression(columns, 'a', 'created_at', 'CURRENT_TIMESTAMP');

  db.run(
    `INSERT INTO activities (id, user_id, title, created_at)
     SELECT a.id, COALESCE(${userId}, @ownerId), trim(COALESCE(${title}, 'Atividade migrada ' || a.id)),
            COALESCE(${createdAt}, CURRENT_TIMESTAMP)
     FROM activities_legacy_tenant AS a
     ORDER BY a.id`,
    { ownerId }
  );
}

function copyLegacyTimeframes(db) {
  const tableName = 'timeframes_legacy_tenant';
  if (!tableExists(db, tableName)) return;
  const columns = tableColumns(db, tableName);
  const type = columnExpression(columns, 'tf', 'type', "'daily'");
  const current = columnExpression(columns, 'tf', 'current', '0');
  const previous = columnExpression(columns, 'tf', 'previous', '0');

  db.exec(`
    INSERT INTO timeframes (id, activity_id, type, current, previous)
    SELECT tf.id, tf.activity_id, ${type},
           CASE WHEN COALESCE(${current}, 0) < 0 THEN 0 ELSE COALESCE(${current}, 0) END,
           CASE WHEN COALESCE(${previous}, 0) < 0 THEN 0 ELSE COALESCE(${previous}, 0) END
    FROM timeframes_legacy_tenant AS tf
    ORDER BY tf.id;
  `);
}

function copyLegacyGoals(db) {
  const tableName = 'goals_legacy_tenant';
  if (!tableExists(db, tableName)) return;
  const columns = tableColumns(db, tableName);
  const type = columnExpression(columns, 'g', 'type', "'daily'");
  const targetHours = columnExpression(columns, 'g', 'target_hours', '0');

  db.exec(`
    INSERT INTO goals (id, activity_id, type, target_hours)
    SELECT g.id, g.activity_id, ${type},
           CASE WHEN COALESCE(${targetHours}, 0) < 0 THEN 0 ELSE COALESCE(${targetHours}, 0) END
    FROM goals_legacy_tenant AS g
    ORDER BY g.id;
  `);
}

function copyLegacyProfiles(db, ownerId) {
  const tableName = 'profile_data_legacy_tenant';
  if (!tableExists(db, tableName)) return;
  const columns = tableColumns(db, tableName);
  const userId = columnExpression(columns, 'p', 'user_id', '@ownerId');
  const username = columnExpression(columns, 'p', 'username', "'Usuário Kairo'");
  const email = columnExpression(columns, 'p', 'email', "''");
  const avatar = columnExpression(columns, 'p', 'avatar', 'NULL');
  const theme = columnExpression(columns, 'p', 'theme', "'escuro'");
  const focusSound = columnExpression(columns, 'p', 'focus_sound', "'chuva'");
  const confetti = columnExpression(columns, 'p', 'enable_confetti', '1');
  const createdAt = columnExpression(columns, 'p', 'created_at', 'CURRENT_TIMESTAMP');
  const updatedAt = columnExpression(columns, 'p', 'updated_at', 'CURRENT_TIMESTAMP');

  db.run(
    `INSERT INTO profile_data
       (id, user_id, username, email, avatar, theme, focus_sound, enable_confetti, created_at, updated_at)
     SELECT p.id, COALESCE(${userId}, @ownerId),
            trim(COALESCE(${username}, 'Usuário Kairo')), COALESCE(${email}, ''), ${avatar},
            CASE WHEN ${theme} IN ('escuro', 'claro') THEN ${theme} ELSE 'escuro' END,
            COALESCE(${focusSound}, 'chuva'), CASE WHEN ${confetti} = 0 THEN 0 ELSE 1 END,
            COALESCE(${createdAt}, CURRENT_TIMESTAMP), COALESCE(${updatedAt}, CURRENT_TIMESTAMP)
     FROM profile_data_legacy_tenant AS p
     ORDER BY p.id`,
    { ownerId }
  );
}

function copyLegacyAgenda(db, ownerId) {
  const tableName = 'agenda_events_legacy_tenant';
  if (!tableExists(db, tableName)) return;
  const columns = tableColumns(db, tableName);
  const userId = columnExpression(columns, 'e', 'user_id', '@ownerId');
  const description = columnExpression(columns, 'e', 'description', "''");
  const duration = columnExpression(columns, 'e', 'duration_hours', '0');
  const completed = columnExpression(columns, 'e', 'is_completed', '0');
  const priority = columnExpression(columns, 'e', 'priority', "'media'");
  const cognitiveLoad = columnExpression(columns, 'e', 'cognitive_load', '1');
  const eventColor = columnExpression(columns, 'e', 'event_color', 'NULL');
  const googleEventId = columnExpression(columns, 'e', 'google_event_id', 'NULL');
  const googleSyncedAt = columnExpression(columns, 'e', 'google_synced_at', 'NULL');
  const createdAt = columnExpression(columns, 'e', 'created_at', 'CURRENT_TIMESTAMP');

  db.run(
    `INSERT INTO agenda_events
       (id, user_id, activity_id, title, description, event_date, start_time, end_time,
        duration_hours, is_completed, priority, cognitive_load, event_color,
        google_event_id, google_synced_at, created_at)
     SELECT e.id, COALESCE(${userId}, @ownerId), e.activity_id, trim(e.title),
            COALESCE(${description}, ''), e.event_date, e.start_time, e.end_time,
            CASE WHEN COALESCE(${duration}, 0) < 0 THEN 0 ELSE COALESCE(${duration}, 0) END,
            CASE WHEN ${completed} = 1 THEN 1 ELSE 0 END,
            CASE WHEN ${priority} IN ('baixa', 'media', 'alta') THEN ${priority} ELSE 'media' END,
            CASE
              WHEN COALESCE(${cognitiveLoad}, 1) < 1 THEN 1
              WHEN COALESCE(${cognitiveLoad}, 1) > 3 THEN 3
              ELSE COALESCE(${cognitiveLoad}, 1)
            END,
            ${eventColor}, ${googleEventId}, ${googleSyncedAt}, COALESCE(${createdAt}, CURRENT_TIMESTAMP)
     FROM agenda_events_legacy_tenant AS e
     ORDER BY e.id`,
    { ownerId }
  );
}

function copyLegacyGoogleTokens(db, ownerId) {
  const tableName = 'google_tokens_legacy_tenant';
  if (!tableExists(db, tableName)) return;
  const columns = tableColumns(db, tableName);
  const userId = columnExpression(columns, 'gt', 'user_id', '@ownerId');
  const accessToken = columnExpression(columns, 'gt', 'access_token', 'NULL');
  const refreshToken = columnExpression(columns, 'gt', 'refresh_token', 'NULL');
  const scope = columnExpression(columns, 'gt', 'scope', 'NULL');
  const tokenType = columnExpression(columns, 'gt', 'token_type', 'NULL');
  const expiryDate = columnExpression(columns, 'gt', 'expiry_date', 'NULL');
  const calendarId = columnExpression(columns, 'gt', 'calendar_id', "'primary'");
  const syncToken = columnExpression(columns, 'gt', 'sync_token', 'NULL');
  const connectedEmail = columnExpression(columns, 'gt', 'connected_email', 'NULL');
  const updatedAt = columnExpression(columns, 'gt', 'updated_at', 'CURRENT_TIMESTAMP');

  db.run(
    `INSERT INTO google_tokens
       (id, user_id, access_token, refresh_token, scope, token_type, expiry_date,
        calendar_id, sync_token, connected_email, updated_at)
     SELECT gt.id, COALESCE(${userId}, @ownerId), ${accessToken}, ${refreshToken}, ${scope},
            ${tokenType}, ${expiryDate}, COALESCE(${calendarId}, 'primary'), ${syncToken},
            ${connectedEmail}, COALESCE(${updatedAt}, CURRENT_TIMESTAMP)
     FROM google_tokens_legacy_tenant AS gt
     ORDER BY gt.id`,
    { ownerId }
  );
}

function copyLegacyData(db, ownerId) {
  copyLegacyActivities(db, ownerId);
  copyLegacyTimeframes(db);
  copyLegacyGoals(db);
  copyLegacyProfiles(db, ownerId);
  copyLegacyAgenda(db, ownerId);
  copyLegacyGoogleTokens(db, ownerId);
}

function dropLegacyTables(db) {
  for (const tableName of CHILD_FIRST_TABLES) {
    db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(`${tableName}_legacy_tenant`)}`);
  }
}

function markMigrationApplied(db) {
  db.run(
    `INSERT INTO schema_migrations (name, applied_at)
     VALUES (?, CURRENT_TIMESTAMP)
     ON CONFLICT(name) DO UPDATE SET applied_at = excluded.applied_at`,
    [TENANT_ISOLATION_MIGRATION]
  );
}

function timestampForFilename(now = new Date()) {
  return now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function defaultBackupPath(db, backupDirectory) {
  const sourceName = db.filename === ':memory:' ? 'kairo-memory.sqlite' : path.basename(db.filename);
  const directory = backupDirectory
    ? path.resolve(backupDirectory)
    : path.join(db.filename === ':memory:' ? process.cwd() : path.dirname(db.filename), 'backups');
  return path.join(
    directory,
    `${sourceName}.pre-${TENANT_ISOLATION_MIGRATION}-${timestampForFilename()}.backup.sqlite`
  );
}

export function migrateTenantIsolation(db, ownerId, options = {}) {
  const normalizedOwnerId = assertOwnerExists(db, ownerId);
  ensureMigrationTable(db);
  const backupPath = options.backupPath
    ? path.resolve(options.backupPath)
    : defaultBackupPath(db, options.backupDirectory);

  db.backupSync(backupPath);
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction((transactionDb) => {
      renameLegacyTables(transactionDb);
      createCoreTables(transactionDb);
      copyLegacyData(transactionDb, normalizedOwnerId);
      dropLegacyTables(transactionDb);
      markMigrationApplied(transactionDb);

      const schemaInspection = inspectCoreSchema(transactionDb);
      if (!schemaInspection.valid) {
        throw new Error(`A migração produziu uma estrutura incompleta: ${schemaInspection.issues.join('; ')}`);
      }
      assertNoForeignKeyViolations(transactionDb);
    });
  } finally {
    db.pragma('foreign_keys = ON');
  }

  assertNoForeignKeyViolations(db);
  return { migrated: true, backupPath };
}

export function ensureTenantIsolation(db, ownerId, options = {}) {
  const normalizedOwnerId = assertOwnerExists(db, ownerId);
  ensureMigrationTable(db);

  const existingCoreTables = CORE_TABLES.filter((tableName) => tableExists(db, tableName));
  const applied = db.get(
    'SELECT schema_migrations.name FROM schema_migrations WHERE schema_migrations.name = ?',
    [TENANT_ISOLATION_MIGRATION]
  );

  if (existingCoreTables.length === 0) {
    db.transaction((transactionDb) => {
      createCoreTables(transactionDb);
      markMigrationApplied(transactionDb);
      const inspection = inspectCoreSchema(transactionDb);
      if (!inspection.valid) {
        throw new Error(`A estrutura inicial do banco ficou incompleta: ${inspection.issues.join('; ')}`);
      }
      assertNoForeignKeyViolations(transactionDb);
    });
    return { migrated: false, created: true, backupPath: null };
  }

  const inspection = inspectCoreSchema(db);
  if (!applied || !inspection.valid) {
    return migrateTenantIsolation(db, normalizedOwnerId, options);
  }

  db.transaction((transactionDb) => {
    createCoreTables(transactionDb);
    const confirmed = inspectCoreSchema(transactionDb);
    if (!confirmed.valid) {
      throw new Error(`A estrutura do banco não corresponde ao contrato: ${confirmed.issues.join('; ')}`);
    }
    assertNoForeignKeyViolations(transactionDb);
  });
  return { migrated: false, created: false, backupPath: null };
}
