// ============================================================================
// Kairo — Motor transacional de recompensas, Dopamenu e métricas administrativas
// ============================================================================

import crypto from 'node:crypto';
import { conflict, notFound, unprocessable } from '../../shared/http-error.js';
import {
  AI_REWARD_KEYS,
  DOPAMINE_GENERATOR_KEYS,
  aiRewardConfigSchema,
  completionSchema,
  createDopamenuItemSchema,
  generatorConfigSchema,
  rewardFeedbackSchema,
  updateDopamenuItemSchema
} from './rewards.schemas.js';

export const REWARDS_SCHEMA_MIGRATION = '002_recompensas_isoladas';

export const DOPAMINE_GENERATORS = Object.freeze([
  { key: 'recompensa_variavel', label: 'Recompensa Variável + Jackpot' },
  { key: 'bau_loot', label: 'Baú / Loot Colecionável' },
  { key: 'combo', label: 'Combo / Momentum' },
  { key: 'micro_conclusoes', label: 'Micro-conclusões' },
  { key: 'antecipacao', label: 'Antecipação Visível' },
  { key: 'mensagens_rpe', label: 'Mensagens “melhor que o esperado”' },
  { key: 'multissensorial', label: 'Celebração Multissensorial' },
  { key: 'dopamenu', label: 'Dopamenu (cardápio pessoal)' },
  { key: 'surpresa', label: 'Recompensa em Momento Surpresa' }
]);

const REWARD_TABLES = Object.freeze([
  'user_gamification',
  'dopamenu',
  'dopamine_config',
  'ai_reward_config',
  'reward_events',
  'reward_feedback'
]);

const REQUIRED_COLUMNS = Object.freeze({
  user_gamification: [
    'user_id', 'coins', 'current_streak', 'longest_streak', 'today_date',
    'today_count', 'best_day_count', 'total_completions', 'combo',
    'collectibles', 'last_completion_at', 'updated_at'
  ],
  dopamenu: ['id', 'user_id', 'category', 'label', 'created_at'],
  dopamine_config: ['feature_key', 'enabled', 'updated_at'],
  ai_reward_config: ['key', 'value', 'updated_at'],
  reward_events: [
    'id', 'user_id', 'agenda_event_id', 'tier', 'generator', 'coins', 'chest',
    'collectible', 'jackpot', 'context', 'combo', 'message', 'multissensorial',
    'streak', 'longest_streak', 'today_count', 'best_day_count',
    'total_completions', 'anticipation', 'dopamenu_json', 'surprise_message',
    'created_at'
  ],
  reward_feedback: [
    'id', 'user_id', 'reward_event_id', 'generator', 'rating', 'created_at'
  ]
});

const COLLECTIBLES = Object.freeze([
  '🌟 Estrela Radiante',
  '🔥 Chama do Foco',
  '💎 Diamante Raro',
  '🏆 Troféu de Ouro',
  '🎖️ Medalha Gamma',
  '🚀 Foguete Turbo',
  '🧠 Cérebro Zen',
  '⚡ Raio Dopamínico',
  '🎁 Caixa Misteriosa',
  '🌈 Prisma da Constância'
]);

const RPE_MESSAGES = Object.freeze([
  'Melhor do que o esperado! 🎉',
  'Você mandou muito bem!',
  'Isso foi difícil e você fez! 💪',
  'Sequência imparável! 🔥',
  'Recorde à vista! 🏅',
  'O foco está com você hoje!',
  'Dopamina liberada — continue! ✨',
  'Mais um vencido, orgulho de você!'
]);

const DEFAULT_DOPAMENU = Object.freeze([
  { category: 'entrada', label: 'Alongar por 2 minutos' },
  { category: 'entrada', label: 'Beber água / café' },
  { category: 'principal', label: 'Ouvir 1 música favorita' },
  { category: 'principal', label: 'Caminhar 5 minutos' },
  { category: 'sobremesa', label: 'Ver um vídeo curto engraçado' },
  { category: 'sobremesa', label: 'Mandar mensagem para alguém querido' }
]);

const GENERATOR_SQL_LIST = DOPAMINE_GENERATOR_KEYS.map((key) => `'${key}'`).join(', ');
const AI_KEY_SQL_LIST = AI_REWARD_KEYS.map((key) => `'${key}'`).join(', ');
const LEGACY_SUFFIX = '_legacy_rewards';

function tableExists(db, tableName) {
  return Boolean(db.get(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  ));
}

function tableColumns(db, tableName) {
  if (!tableExists(db, tableName)) return new Set();
  return new Set(db.all(`PRAGMA table_info("${tableName}")`).map((column) => column.name));
}

function columnExpression(columns, alias, column, fallback) {
  return columns.has(column) ? `${alias}."${column}"` : fallback;
}

function hasForeignKeyTo(db, tableName, targetTable) {
  return db.all(`PRAGMA foreign_key_list("${tableName}")`)
    .some((foreignKey) => foreignKey.table === targetTable);
}

function hasCurrentRewardsSchema(db) {
  for (const tableName of REWARD_TABLES) {
    const columns = tableColumns(db, tableName);
    if (columns.size === 0) return false;
    if (REQUIRED_COLUMNS[tableName].some((column) => !columns.has(column))) return false;
  }

  return hasForeignKeyTo(db, 'user_gamification', 'users')
    && hasForeignKeyTo(db, 'dopamenu', 'users')
    && hasForeignKeyTo(db, 'reward_events', 'users')
    && hasForeignKeyTo(db, 'reward_events', 'agenda_events')
    && hasForeignKeyTo(db, 'reward_feedback', 'users')
    && hasForeignKeyTo(db, 'reward_feedback', 'reward_events');
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function createRewardsTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_gamification (
      user_id INTEGER PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
      current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
      longest_streak INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= current_streak),
      today_date TEXT DEFAULT NULL
        CHECK (today_date IS NULL OR today_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      today_count INTEGER NOT NULL DEFAULT 0 CHECK (today_count >= 0),
      best_day_count INTEGER NOT NULL DEFAULT 0 CHECK (best_day_count >= today_count),
      total_completions INTEGER NOT NULL DEFAULT 0 CHECK (total_completions >= 0),
      combo INTEGER NOT NULL DEFAULT 0 CHECK (combo BETWEEN 0 AND 10),
      collectibles TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(collectibles) AND json_type(collectibles) = 'array'),
      last_completion_at DATETIME DEFAULT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dopamenu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'principal'
        CHECK (category IN ('entrada', 'principal', 'sobremesa')),
      label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 2 AND 160),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      UNIQUE (user_id, category, label)
    );

    CREATE TABLE IF NOT EXISTS dopamine_config (
      feature_key TEXT PRIMARY KEY CHECK (feature_key IN (${GENERATOR_SQL_LIST})),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_reward_config (
      key TEXT PRIMARY KEY CHECK (key IN (${AI_KEY_SQL_LIST})),
      value INTEGER NOT NULL DEFAULT 0 CHECK (value IN (0, 1)),
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reward_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      agenda_event_id INTEGER DEFAULT NULL,
      tier TEXT NOT NULL CHECK (tier IN ('normal', 'grande', 'jackpot', 'bau')),
      generator TEXT DEFAULT NULL
        CHECK (generator IS NULL OR generator IN (${GENERATOR_SQL_LIST})),
      coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
      chest INTEGER NOT NULL DEFAULT 0 CHECK (chest IN (0, 1)),
      collectible TEXT DEFAULT NULL CHECK (collectible IS NULL OR length(collectible) <= 160),
      jackpot INTEGER NOT NULL DEFAULT 0 CHECK (jackpot IN (0, 1)),
      context TEXT NOT NULL DEFAULT 'agenda' CHECK (length(context) BETWEEN 1 AND 40),
      combo INTEGER NOT NULL DEFAULT 1 CHECK (combo BETWEEN 0 AND 10),
      message TEXT NOT NULL DEFAULT 'Atividade concluída!' CHECK (length(message) <= 300),
      multissensorial INTEGER NOT NULL DEFAULT 0 CHECK (multissensorial IN (0, 1)),
      streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
      longest_streak INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
      today_count INTEGER NOT NULL DEFAULT 0 CHECK (today_count >= 0),
      best_day_count INTEGER NOT NULL DEFAULT 0 CHECK (best_day_count >= 0),
      total_completions INTEGER NOT NULL DEFAULT 0 CHECK (total_completions >= 0),
      anticipation INTEGER DEFAULT NULL CHECK (anticipation IS NULL OR anticipation BETWEEN 0 AND 4),
      dopamenu_json TEXT DEFAULT NULL
        CHECK (dopamenu_json IS NULL OR (json_valid(dopamenu_json) AND json_type(dopamenu_json) = 'object')),
      surprise_message TEXT DEFAULT NULL CHECK (surprise_message IS NULL OR length(surprise_message) <= 300),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (agenda_event_id) REFERENCES agenda_events (id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS reward_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      reward_event_id INTEGER NOT NULL,
      generator TEXT DEFAULT NULL
        CHECK (generator IS NULL OR generator IN (${GENERATOR_SQL_LIST})),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (reward_event_id) REFERENCES reward_events (id) ON DELETE CASCADE,
      UNIQUE (user_id, reward_event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_dopamenu_user_category
      ON dopamenu (user_id, category, id);
    CREATE INDEX IF NOT EXISTS idx_reward_events_user_date
      ON reward_events (user_id, created_at DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_events_user_agenda_unique
      ON reward_events (user_id, agenda_event_id)
      WHERE agenda_event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_reward_events_generator_date
      ON reward_events (generator, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reward_feedback_generator_date
      ON reward_feedback (generator, created_at DESC);
  `);

  db.exec(`
    DROP TRIGGER IF EXISTS reward_events_owner_insert;
    DROP TRIGGER IF EXISTS reward_events_owner_update;
    DROP TRIGGER IF EXISTS reward_feedback_owner_insert;
    DROP TRIGGER IF EXISTS reward_feedback_owner_update;

    CREATE TRIGGER reward_events_owner_insert
    BEFORE INSERT ON reward_events
    WHEN NEW.agenda_event_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM agenda_events
        WHERE agenda_events.id = NEW.agenda_event_id
          AND agenda_events.user_id = NEW.user_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'REWARD_EVENT_OWNER_MISMATCH');
    END;

    CREATE TRIGGER reward_events_owner_update
    BEFORE UPDATE OF user_id, agenda_event_id ON reward_events
    WHEN NEW.agenda_event_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM agenda_events
        WHERE agenda_events.id = NEW.agenda_event_id
          AND agenda_events.user_id = NEW.user_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'REWARD_EVENT_OWNER_MISMATCH');
    END;

    CREATE TRIGGER reward_feedback_owner_insert
    BEFORE INSERT ON reward_feedback
    WHEN NOT EXISTS (
      SELECT 1 FROM reward_events
      WHERE reward_events.id = NEW.reward_event_id
        AND reward_events.user_id = NEW.user_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'REWARD_FEEDBACK_OWNER_MISMATCH');
    END;

    CREATE TRIGGER reward_feedback_owner_update
    BEFORE UPDATE OF user_id, reward_event_id ON reward_feedback
    WHEN NOT EXISTS (
      SELECT 1 FROM reward_events
      WHERE reward_events.id = NEW.reward_event_id
        AND reward_events.user_id = NEW.user_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'REWARD_FEEDBACK_OWNER_MISMATCH');
    END;
  `);
}

function renameLegacyRewardsTables(db) {
  for (const tableName of ['reward_feedback', 'reward_events', 'dopamenu', 'user_gamification', 'dopamine_config', 'ai_reward_config']) {
    if (!tableExists(db, tableName)) continue;
    const legacyName = `${tableName}${LEGACY_SUFFIX}`;
    if (tableExists(db, legacyName)) {
      throw new Error(`A migração encontrou a tabela temporária inesperada ${legacyName}.`);
    }
    db.exec(`ALTER TABLE "${tableName}" RENAME TO "${legacyName}"`);
  }
}

function copyLegacyUserGamification(db) {
  const tableName = `user_gamification${LEGACY_SUFFIX}`;
  if (!tableExists(db, tableName)) return;
  const columns = tableColumns(db, tableName);
  const value = (name, fallback) => columnExpression(columns, 'g', name, fallback);
  const collectibles = value('collectibles', "'[]'");

  db.exec(`
    INSERT INTO user_gamification (
      user_id, coins, current_streak, longest_streak, today_date, today_count,
      best_day_count, total_completions, combo, collectibles,
      last_completion_at, updated_at
    )
    SELECT
      g.user_id,
      MAX(COALESCE(${value('coins', '0')}, 0), 0),
      MAX(COALESCE(${value('current_streak', '0')}, 0), 0),
      MAX(
        MAX(COALESCE(${value('longest_streak', '0')}, 0), 0),
        MAX(COALESCE(${value('current_streak', '0')}, 0), 0)
      ),
      CASE
        WHEN ${value('today_date', 'NULL')} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          THEN ${value('today_date', 'NULL')}
        ELSE NULL
      END,
      MAX(COALESCE(${value('today_count', '0')}, 0), 0),
      MAX(
        MAX(COALESCE(${value('best_day_count', '0')}, 0), 0),
        MAX(COALESCE(${value('today_count', '0')}, 0), 0)
      ),
      MAX(COALESCE(${value('total_completions', '0')}, 0), 0),
      MIN(MAX(COALESCE(${value('combo', '0')}, 0), 0), 10),
      CASE WHEN json_valid(${collectibles}) = 1
        THEN CASE WHEN json_type(${collectibles}) = 'array' THEN ${collectibles} ELSE '[]' END
        ELSE '[]'
      END,
      ${value('last_completion_at', 'NULL')},
      COALESCE(${value('updated_at', 'NULL')}, CURRENT_TIMESTAMP)
    FROM "${tableName}" AS g
    JOIN users ON users.id = g.user_id;
  `);
}

function copyLegacyDopamenu(db) {
  const tableName = `dopamenu${LEGACY_SUFFIX}`;
  if (!tableExists(db, tableName)) return;
  const columns = tableColumns(db, tableName);
  if (!columns.has('user_id') || !columns.has('label')) return;
  const category = columnExpression(columns, 'd', 'category', "'principal'");
  const createdAt = columnExpression(columns, 'd', 'created_at', 'CURRENT_TIMESTAMP');

  db.exec(`
    WITH normalized AS (
      SELECT
        d.id,
        d.user_id,
        CASE WHEN ${category} IN ('entrada', 'principal', 'sobremesa')
          THEN ${category} ELSE 'principal' END AS category,
        substr(trim(d.label), 1, 160) AS label,
        COALESCE(${createdAt}, CURRENT_TIMESTAMP) AS created_at
      FROM "${tableName}" AS d
      JOIN users ON users.id = d.user_id
      WHERE length(trim(COALESCE(d.label, ''))) >= 2
    )
    INSERT OR IGNORE INTO dopamenu (id, user_id, category, label, created_at)
    SELECT id, user_id, category, label, created_at
    FROM normalized
    ORDER BY id;
  `);
}

function copyLegacyConfiguration(db) {
  const dopamineTable = `dopamine_config${LEGACY_SUFFIX}`;
  if (tableExists(db, dopamineTable)) {
    const columns = tableColumns(db, dopamineTable);
    if (columns.has('feature_key')) {
      const enabled = columnExpression(columns, 'c', 'enabled', '1');
      const updatedAt = columnExpression(columns, 'c', 'updated_at', 'CURRENT_TIMESTAMP');
      db.exec(`
        INSERT OR IGNORE INTO dopamine_config (feature_key, enabled, updated_at)
        SELECT c.feature_key, CASE WHEN ${enabled} = 0 THEN 0 ELSE 1 END,
               COALESCE(${updatedAt}, CURRENT_TIMESTAMP)
        FROM "${dopamineTable}" AS c
        WHERE c.feature_key IN (${GENERATOR_SQL_LIST});
      `);
    }
  }

  const aiTable = `ai_reward_config${LEGACY_SUFFIX}`;
  if (tableExists(db, aiTable)) {
    const columns = tableColumns(db, aiTable);
    if (columns.has('key')) {
      const value = columnExpression(columns, 'c', 'value', '0');
      const updatedAt = columnExpression(columns, 'c', 'updated_at', 'CURRENT_TIMESTAMP');
      db.exec(`
        INSERT OR IGNORE INTO ai_reward_config (key, value, updated_at)
        SELECT c.key, CASE WHEN ${value} = 1 THEN 1 ELSE 0 END,
               COALESCE(${updatedAt}, CURRENT_TIMESTAMP)
        FROM "${aiTable}" AS c
        WHERE c.key IN (${AI_KEY_SQL_LIST});
      `);
    }
  }
}

function copyLegacyRewardEvents(db) {
  const tableName = `reward_events${LEGACY_SUFFIX}`;
  if (!tableExists(db, tableName)) return;
  const columns = tableColumns(db, tableName);
  if (!columns.has('user_id')) return;
  const value = (name, fallback) => columnExpression(columns, 'r', name, fallback);
  const agendaEvent = value('agenda_event_id', 'NULL');
  const generator = value('generator', 'NULL');
  const dopamenu = value('dopamenu_json', 'NULL');

  db.exec(`
    INSERT OR IGNORE INTO reward_events (
      id, user_id, agenda_event_id, tier, generator, coins, chest, collectible,
      jackpot, context, combo, message, multissensorial, streak,
      longest_streak, today_count, best_day_count, total_completions,
      anticipation, dopamenu_json, surprise_message, created_at
    )
    SELECT
      r.id,
      r.user_id,
      CASE WHEN EXISTS (
        SELECT 1 FROM agenda_events AS a
        WHERE a.id = ${agendaEvent} AND a.user_id = r.user_id
      ) THEN ${agendaEvent} ELSE NULL END,
      CASE WHEN ${value('tier', "'normal'")} IN ('normal', 'grande', 'jackpot', 'bau')
        THEN ${value('tier', "'normal'")} ELSE 'normal' END,
      CASE WHEN ${generator} IN (${GENERATOR_SQL_LIST}) THEN ${generator} ELSE NULL END,
      MAX(COALESCE(${value('coins', '0')}, 0), 0),
      CASE WHEN ${value('chest', '0')} = 1 THEN 1 ELSE 0 END,
      CASE WHEN length(${value('collectible', "''")}) BETWEEN 1 AND 160
        THEN ${value('collectible', 'NULL')} ELSE NULL END,
      CASE WHEN ${value('jackpot', '0')} = 1 THEN 1 ELSE 0 END,
      substr(COALESCE(NULLIF(${value('context', "'agenda'")}, ''), 'agenda'), 1, 40),
      MIN(MAX(COALESCE(${value('combo', '1')}, 1), 0), 10),
      substr(COALESCE(${value('message', "'Atividade concluída!'")}, 'Atividade concluída!'), 1, 300),
      CASE WHEN ${value('multissensorial', '0')} = 1 THEN 1 ELSE 0 END,
      MAX(COALESCE(${value('streak', '0')}, 0), 0),
      MAX(COALESCE(${value('longest_streak', '0')}, 0), 0),
      MAX(COALESCE(${value('today_count', '0')}, 0), 0),
      MAX(COALESCE(${value('best_day_count', '0')}, 0), 0),
      MAX(COALESCE(${value('total_completions', '0')}, 0), 0),
      CASE WHEN ${value('anticipation', 'NULL')} BETWEEN 0 AND 4
        THEN ${value('anticipation', 'NULL')} ELSE NULL END,
      CASE WHEN json_valid(${dopamenu}) = 1
        THEN CASE WHEN json_type(${dopamenu}) = 'object' THEN ${dopamenu} ELSE NULL END
        ELSE NULL
      END,
      substr(${value('surprise_message', 'NULL')}, 1, 300),
      COALESCE(${value('created_at', 'NULL')}, CURRENT_TIMESTAMP)
    FROM "${tableName}" AS r
    JOIN users ON users.id = r.user_id
    ORDER BY r.id;
  `);
}

function copyLegacyRewardFeedback(db) {
  const tableName = `reward_feedback${LEGACY_SUFFIX}`;
  if (!tableExists(db, tableName)) return;
  const columns = tableColumns(db, tableName);
  if (!columns.has('reward_event_id') || !columns.has('rating')) return;
  const createdAt = columnExpression(columns, 'f', 'created_at', 'CURRENT_TIMESTAMP');

  db.exec(`
    INSERT OR IGNORE INTO reward_feedback (
      id, user_id, reward_event_id, generator, rating, created_at
    )
    SELECT
      f.id,
      events.user_id,
      events.id,
      events.generator,
      CAST(f.rating AS INTEGER),
      COALESCE(${createdAt}, CURRENT_TIMESTAMP)
    FROM "${tableName}" AS f
    JOIN reward_events AS events ON events.id = f.reward_event_id
    WHERE CAST(f.rating AS INTEGER) BETWEEN 1 AND 5
    ORDER BY f.id;
  `);
}

function dropLegacyRewardsTables(db) {
  for (const tableName of ['reward_feedback', 'reward_events', 'dopamenu', 'user_gamification', 'dopamine_config', 'ai_reward_config']) {
    const legacyName = `${tableName}${LEGACY_SUFFIX}`;
    if (tableExists(db, legacyName)) db.exec(`DROP TABLE "${legacyName}"`);
  }
}

function seedRewardsConfiguration(db) {
  for (const generator of DOPAMINE_GENERATORS) {
    db.run(
      `INSERT OR IGNORE INTO dopamine_config (feature_key, enabled)
       VALUES (?, 1)`,
      [generator.key]
    );
  }
  for (const key of AI_REWARD_KEYS) {
    db.run(
      `INSERT OR IGNORE INTO ai_reward_config (key, value)
       VALUES (?, 0)`,
      [key]
    );
  }
}

function markRewardsMigration(db) {
  db.run(
    `INSERT INTO schema_migrations (name, applied_at)
     VALUES (?, CURRENT_TIMESTAMP)
     ON CONFLICT(name) DO UPDATE SET applied_at = excluded.applied_at`,
    [REWARDS_SCHEMA_MIGRATION]
  );
}

function assertRewardsForeignKeys(db) {
  const violations = db.pragma('foreign_key_check')
    .filter((violation) => REWARD_TABLES.includes(violation.table));
  if (violations.length > 0) {
    throw new Error(`A migração de recompensas produziu ${violations.length} violação(ões) relacionais.`);
  }
}

export function ensureRewardsSchema(db) {
  if (!db) throw new Error('O banco é obrigatório para inicializar as recompensas.');
  if (!tableExists(db, 'users') || !tableExists(db, 'agenda_events')) {
    throw new Error('Usuários e agenda precisam estar inicializados antes das recompensas.');
  }

  ensureMigrationTable(db);
  const current = hasCurrentRewardsSchema(db);
  const existingTables = REWARD_TABLES.filter((tableName) => tableExists(db, tableName));

  if (current || existingTables.length === 0) {
    db.transaction((transactionDb) => {
      createRewardsTables(transactionDb);
      seedRewardsConfiguration(transactionDb);
      markRewardsMigration(transactionDb);
      assertRewardsForeignKeys(transactionDb);
    });
    return { migrated: false, created: existingTables.length === 0 };
  }

  if (db.inTransaction) {
    throw new Error('A migração das recompensas precisa iniciar fora de uma transação existente.');
  }

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction((transactionDb) => {
      renameLegacyRewardsTables(transactionDb);
      createRewardsTables(transactionDb);
      copyLegacyUserGamification(transactionDb);
      copyLegacyDopamenu(transactionDb);
      copyLegacyConfiguration(transactionDb);
      copyLegacyRewardEvents(transactionDb);
      copyLegacyRewardFeedback(transactionDb);
      dropLegacyRewardsTables(transactionDb);
      // Índices antigos acompanham as tabelas renomeadas. Reaplicar o contrato
      // depois da remoção garante que os nomes e índices pertençam às tabelas finais.
      createRewardsTables(transactionDb);
      seedRewardsConfiguration(transactionDb);
      markRewardsMigration(transactionDb);
      if (!hasCurrentRewardsSchema(transactionDb)) {
        throw new Error('A migração produziu uma estrutura de recompensas incompleta.');
      }
      assertRewardsForeignKeys(transactionDb);
    });
  } finally {
    db.pragma('foreign_keys = ON');
  }

  if (!hasCurrentRewardsSchema(db)) {
    throw new Error('A estrutura final das recompensas não corresponde ao contrato esperado.');
  }
  assertRewardsForeignKeys(db);
  return { migrated: true, created: false };
}

function validationDetails(error) {
  return error.issues.map((issue) => ({
    campo: issue.path.length > 0 ? issue.path.join('.') : 'requisição',
    mensagem: issue.message
  }));
}

function parseServiceInput(schema, input, message, code) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw unprocessable(message, code, validationDetails(parsed.error));
  }
  return parsed.data;
}

function normalizePositiveId(value, field = 'identificador') {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw unprocessable(`O ${field} precisa ser um inteiro positivo.`, 'IDENTIFICADOR_INVALIDO');
  }
  return normalized;
}

function parseCollectibles(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseOptionalObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sqliteTimestampToMilliseconds(value) {
  if (!value) return Number.NaN;
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/i.test(value)
    ? value
    : `${String(value).replace(' ', 'T')}Z`;
  return Date.parse(normalized);
}

function isoDateFromParts(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shiftIsoDate(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day + days);
  return isoDateFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function currentDate(dateFormatter, now) {
  const date = now();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('O relógio das recompensas retornou uma data inválida.');
  }
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isConstraint(error, fragment) {
  return String(error?.code || '').startsWith('SQLITE_CONSTRAINT')
    && String(error?.message || '').includes(fragment);
}

function serializeState(row) {
  return {
    coins: Number(row.coins),
    current_streak: Number(row.current_streak),
    longest_streak: Number(row.longest_streak),
    today_count: Number(row.today_count),
    best_day_count: Number(row.best_day_count),
    total_completions: Number(row.total_completions),
    combo: Number(row.combo),
    collectibles: parseCollectibles(row.collectibles)
  };
}

function serializeReward(event, state, idempotent) {
  return {
    event_id: Number(event.id),
    agenda_event_id: event.agenda_event_id === null ? null : Number(event.agenda_event_id),
    tier: event.tier,
    jackpot: Boolean(event.jackpot),
    coins: Number(event.coins),
    coins_total: Number(state.coins),
    combo: Number(event.combo),
    chest: Boolean(event.chest),
    collectible: event.collectible,
    message: event.message,
    multissensorial: Boolean(event.multissensorial),
    generator: event.generator,
    streak: Number(event.streak),
    longest_streak: Number(event.longest_streak),
    today_count: Number(event.today_count),
    best_day_count: Number(event.best_day_count),
    total: Number(event.total_completions),
    antecipacao: event.anticipation === null ? null : Number(event.anticipation),
    dopamenu: parseOptionalObject(event.dopamenu_json),
    surpresa: event.surprise_message,
    idempotent
  };
}

export function createRewardsService(options) {
  const {
    db,
    randomInt = crypto.randomInt,
    now = () => new Date(),
    timeZone = 'America/Sao_Paulo'
  } = options ?? {};

  if (!db) throw new Error('O banco é obrigatório para o serviço de recompensas.');
  if (typeof randomInt !== 'function') throw new TypeError('O gerador aleatório precisa ser uma função.');
  if (typeof now !== 'function') throw new TypeError('O relógio das recompensas precisa ser uma função.');

  let dateFormatter;
  try {
    dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch (error) {
    throw new TypeError(`O fuso horário das recompensas é inválido: ${timeZone}`, { cause: error });
  }

  function secureIndex(length) {
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new RangeError('Não é possível sortear em uma coleção vazia.');
    }
    const value = randomInt(length);
    if (!Number.isSafeInteger(value) || value < 0 || value >= length) {
      throw new RangeError('O gerador aleatório retornou um valor fora do intervalo permitido.');
    }
    return value;
  }

  function chance(numerator, denominator = 10_000) {
    return secureIndex(denominator) < numerator;
  }

  function getOrCreateUserRow(transactionDb, userId) {
    let row = transactionDb.get(
      'SELECT * FROM user_gamification WHERE user_id = ?',
      [userId]
    );
    if (row) return row;

    const user = transactionDb.get('SELECT id FROM users WHERE id = ? AND is_active = 1', [userId]);
    if (!user) throw notFound('Usuário não encontrado.', 'USUARIO_NAO_ENCONTRADO');

    const inserted = transactionDb.run(
      'INSERT OR IGNORE INTO user_gamification (user_id) VALUES (?)',
      [userId]
    );
    if (inserted.changes === 1) {
      for (const item of DEFAULT_DOPAMENU) {
        transactionDb.run(
          `INSERT OR IGNORE INTO dopamenu (user_id, category, label)
           VALUES (?, ?, ?)`,
          [userId, item.category, item.label]
        );
      }
    }
    row = transactionDb.get('SELECT * FROM user_gamification WHERE user_id = ?', [userId]);
    return row;
  }

  function featureFlags(transactionDb) {
    const flags = Object.fromEntries(DOPAMINE_GENERATOR_KEYS.map((key) => [key, true]));
    for (const row of transactionDb.all('SELECT feature_key, enabled FROM dopamine_config')) {
      if (Object.hasOwn(flags, row.feature_key)) flags[row.feature_key] = Boolean(row.enabled);
    }
    return flags;
  }

  function aiFlags(transactionDb) {
    const flags = Object.fromEntries(AI_REWARD_KEYS.map((key) => [key, false]));
    for (const row of transactionDb.all('SELECT key, value FROM ai_reward_config')) {
      if (Object.hasOwn(flags, row.key)) flags[row.key] = Boolean(row.value);
    }
    return flags;
  }

  function ownCompletedAgendaEvent(transactionDb, userId, eventId) {
    const event = transactionDb.get(
      `SELECT id, user_id, is_completed, cognitive_load
       FROM agenda_events
       WHERE id = ? AND user_id = ?`,
      [eventId, userId]
    );
    if (!event) throw notFound('Compromisso não encontrado.', 'COMPROMISSO_NAO_ENCONTRADO');
    if (!event.is_completed) {
      throw conflict(
        'O compromisso precisa estar concluído antes de receber uma recompensa.',
        'COMPROMISSO_NAO_CONCLUIDO'
      );
    }
    return event;
  }

  function getExistingReward(transactionDb, userId, agendaEventId) {
    return transactionDb.get(
      `SELECT * FROM reward_events
       WHERE user_id = ? AND agenda_event_id = ?`,
      [userId, agendaEventId]
    );
  }

  function registerCompletion(userIdValue, inputValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const input = parseServiceInput(
      completionSchema,
      inputValue,
      'Informe o compromisso concluído.',
      'RECOMPENSA_VALIDACAO_FALHOU'
    );

    return db.transaction((transactionDb) => {
      const existing = getExistingReward(transactionDb, userId, input.agenda_event_id);
      if (existing) {
        return serializeReward(existing, serializeState(getOrCreateUserRow(transactionDb, userId)), true);
      }

      const agendaEvent = ownCompletedAgendaEvent(transactionDb, userId, input.agenda_event_id);
      const row = getOrCreateUserRow(transactionDb, userId);
      const flags = featureFlags(transactionDb);
      const intelligentFlags = aiFlags(transactionDb);
      const today = currentDate(dateFormatter, now);
      const yesterday = shiftIsoDate(today, -1);

      let todayCount;
      let currentStreak;
      if (row.today_date === today) {
        todayCount = Number(row.today_count) + 1;
        currentStreak = Number(row.current_streak);
      } else {
        todayCount = 1;
        currentStreak = row.today_date === yesterday ? Number(row.current_streak) + 1 : 1;
      }

      const longestStreak = Math.max(Number(row.longest_streak), currentStreak);
      const bestDayCount = Math.max(Number(row.best_day_count), todayCount);
      const totalCompletions = Number(row.total_completions) + 1;

      let combo = 1;
      if (flags.combo && row.last_completion_at) {
        const elapsed = now().getTime() - sqliteTimestampToMilliseconds(row.last_completion_at);
        if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 10 * 60 * 1000) {
          combo = Math.min(Number(row.combo) + 1, 10);
        }
      }

      const lastEvent = transactionDb.get(
        `SELECT tier, collectible
         FROM reward_events
         WHERE user_id = ?
         ORDER BY id DESC LIMIT 1`,
        [userId]
      );

      let tier = 'normal';
      let jackpot = false;
      if (flags.recompensa_variavel) {
        let roll = secureIndex(10_000);
        const tierForRoll = (value) => (
          value < 6_800 ? 'normal'
            : value < 9_000 ? 'grande'
              : value < 9_400 ? 'jackpot'
                : flags.bau_loot ? 'bau' : 'grande'
        );
        if (intelligentFlags.nao_repetir && lastEvent && tierForRoll(roll) === lastEvent.tier) {
          roll = secureIndex(10_000);
        }
        tier = tierForRoll(roll);
        jackpot = tier === 'jackpot';
      }

      const baseCoins = { normal: 10, grande: 30, jackpot: 100, bau: 20 }[tier];
      const coins = baseCoins * combo;
      let chest = false;
      let collectible = null;
      const collectibles = parseCollectibles(row.collectibles);
      if ((tier === 'bau' || jackpot) && flags.bau_loot) {
        chest = true;
        let pool = COLLECTIBLES;
        if (intelligentFlags.nao_repetir && lastEvent?.collectible) {
          const filtered = COLLECTIBLES.filter((item) => item !== lastEvent.collectible);
          if (filtered.length > 0) pool = filtered;
        }
        collectible = pool[secureIndex(pool.length)];
        collectibles.push({ item: collectible, at: now().toISOString() });
      }

      let message = 'Atividade concluída!';
      if (flags.mensagens_rpe) {
        if (todayCount === bestDayCount && todayCount > 1) {
          message = `🏅 Recorde do dia: ${todayCount} conclusões!`;
        } else if (currentStreak >= 2) {
          message = `🔥 ${currentStreak} dias seguidos! ${RPE_MESSAGES[secureIndex(RPE_MESSAGES.length)]}`;
        } else {
          message = RPE_MESSAGES[secureIndex(RPE_MESSAGES.length)];
        }
      }

      const newCoins = Number(row.coins) + coins;
      const storedCombo = flags.combo ? combo : 0;
      transactionDb.run(
        `UPDATE user_gamification
         SET coins = ?, current_streak = ?, longest_streak = ?, today_date = ?,
             today_count = ?, best_day_count = ?, total_completions = ?, combo = ?,
             collectibles = ?, last_completion_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [
          newCoins,
          currentStreak,
          longestStreak,
          today,
          todayCount,
          bestDayCount,
          totalCompletions,
          storedCombo,
          JSON.stringify(collectibles),
          userId
        ]
      );

      const generator = jackpot
        ? 'recompensa_variavel'
        : chest
          ? 'bau_loot'
          : combo > 1
            ? 'combo'
            : 'recompensa_variavel';
      const anticipation = flags.antecipacao ? (5 - (totalCompletions % 5)) % 5 : null;

      let dopamenuOffer = null;
      if (flags.dopamenu && (Number(agendaEvent.cognitive_load) >= 3 || chance(2_500))) {
        const menu = transactionDb.all(
          `SELECT id, category, label
           FROM dopamenu
           WHERE user_id = ?
           ORDER BY id`,
          [userId]
        );
        if (menu.length > 0) dopamenuOffer = menu[secureIndex(menu.length)];
      }

      const surprise = flags.surpresa && chance(500)
        ? RPE_MESSAGES[secureIndex(RPE_MESSAGES.length)]
        : null;
      const multissensorial = flags.multissensorial;

      const inserted = transactionDb.run(
        `INSERT INTO reward_events (
          user_id, agenda_event_id, tier, generator, coins, chest, collectible,
          jackpot, context, combo, message, multissensorial, streak,
          longest_streak, today_count, best_day_count, total_completions,
          anticipation, dopamenu_json, surprise_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agenda', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          input.agenda_event_id,
          tier,
          generator,
          coins,
          chest ? 1 : 0,
          collectible,
          jackpot ? 1 : 0,
          combo,
          message,
          multissensorial ? 1 : 0,
          currentStreak,
          longestStreak,
          todayCount,
          bestDayCount,
          totalCompletions,
          anticipation,
          dopamenuOffer ? JSON.stringify(dopamenuOffer) : null,
          surprise
        ]
      );

      const event = transactionDb.get('SELECT * FROM reward_events WHERE id = ?', [inserted.lastID]);
      return serializeReward(event, {
        ...serializeState(row),
        coins: newCoins
      }, false);
    });
  }

  function submitFeedback(userIdValue, inputValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const input = parseServiceInput(
      rewardFeedbackSchema,
      inputValue,
      'Revise a avaliação da recompensa.',
      'AVALIACAO_VALIDACAO_FALHOU'
    );

    try {
      return db.transaction((transactionDb) => {
        const event = transactionDb.get(
          `SELECT id, generator
           FROM reward_events
           WHERE id = ? AND user_id = ?`,
          [input.event_id, userId]
        );
        if (!event) {
          throw notFound('Evento de recompensa não encontrado.', 'RECOMPENSA_NAO_ENCONTRADA');
        }
        const inserted = transactionDb.run(
          `INSERT INTO reward_feedback (user_id, reward_event_id, generator, rating)
           VALUES (?, ?, ?, ?)`,
          [userId, event.id, event.generator, input.rating]
        );
        return {
          id: Number(inserted.lastID),
          event_id: Number(event.id),
          rating: Number(input.rating)
        };
      });
    } catch (error) {
      if (isConstraint(error, 'reward_feedback.user_id, reward_feedback.reward_event_id')) {
        throw conflict(
          'Esta recompensa já recebeu uma avaliação.',
          'AVALIACAO_JA_ENVIADA'
        );
      }
      throw error;
    }
  }

  function getState(userIdValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    return db.transaction((transactionDb) => serializeState(getOrCreateUserRow(transactionDb, userId)));
  }

  function getDopamenu(userIdValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    getState(userId);
    return db.all(
      `SELECT id, category, label
       FROM dopamenu
       WHERE user_id = ?
       ORDER BY id`,
      [userId]
    ).map((item) => ({ ...item, id: Number(item.id) }));
  }

  function addDopamenuItem(userIdValue, inputValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const input = parseServiceInput(
      createDopamenuItemSchema,
      inputValue,
      'Revise o item do Dopamenu.',
      'DOPAMENU_VALIDACAO_FALHOU'
    );
    try {
      return db.transaction((transactionDb) => {
        getOrCreateUserRow(transactionDb, userId);
        const inserted = transactionDb.run(
          `INSERT INTO dopamenu (user_id, category, label)
           VALUES (?, ?, ?)`,
          [userId, input.category, input.label]
        );
        const item = transactionDb.get(
          `SELECT id, category, label
           FROM dopamenu
           WHERE id = ? AND user_id = ?`,
          [inserted.lastID, userId]
        );
        return { ...item, id: Number(item.id) };
      });
    } catch (error) {
      if (isConstraint(error, 'dopamenu.user_id, dopamenu.category, dopamenu.label')) {
        throw conflict('Este item já existe no seu Dopamenu.', 'DOPAMENU_ITEM_DUPLICADO');
      }
      throw error;
    }
  }

  function deleteDopamenuItem(userIdValue, itemIdValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const itemId = normalizePositiveId(itemIdValue, 'item do Dopamenu');
    return db.transaction((transactionDb) => {
      const item = transactionDb.get(
        `SELECT id, category, label
         FROM dopamenu
         WHERE id = ? AND user_id = ?`,
        [itemId, userId]
      );
      if (!item) throw notFound('Item do Dopamenu não encontrado.', 'DOPAMENU_ITEM_NAO_ENCONTRADO');
      const deleted = transactionDb.run(
        'DELETE FROM dopamenu WHERE id = ? AND user_id = ?',
        [itemId, userId]
      );
      if (deleted.changes !== 1) {
        throw notFound('Item do Dopamenu não encontrado.', 'DOPAMENU_ITEM_NAO_ENCONTRADO');
      }
      return { ...item, id: Number(item.id) };
    });
  }

  function updateDopamenuItem(userIdValue, itemIdValue, inputValue) {
    const userId = normalizePositiveId(userIdValue, 'usuário');
    const itemId = normalizePositiveId(itemIdValue, 'item do Dopamenu');
    const input = parseServiceInput(
      updateDopamenuItemSchema,
      inputValue,
      'Revise o item do Dopamenu.',
      'DOPAMENU_VALIDACAO_FALHOU'
    );
    try {
      return db.transaction((transactionDb) => {
        const current = transactionDb.get(
          `SELECT id
           FROM dopamenu
           WHERE id = ? AND user_id = ?`,
          [itemId, userId]
        );
        if (!current) {
          throw notFound('Item do Dopamenu não encontrado.', 'DOPAMENU_ITEM_NAO_ENCONTRADO');
        }
        const updated = transactionDb.run(
          `UPDATE dopamenu
           SET category = ?, label = ?
           WHERE id = ? AND user_id = ?`,
          [input.category, input.label, itemId, userId]
        );
        if (updated.changes !== 1) {
          throw notFound('Item do Dopamenu não encontrado.', 'DOPAMENU_ITEM_NAO_ENCONTRADO');
        }
        const item = transactionDb.get(
          `SELECT id, category, label
           FROM dopamenu
           WHERE id = ? AND user_id = ?`,
          [itemId, userId]
        );
        return { ...item, id: Number(item.id) };
      });
    } catch (error) {
      if (isConstraint(error, 'dopamenu.user_id, dopamenu.category, dopamenu.label')) {
        throw conflict('Este item já existe no seu Dopamenu.', 'DOPAMENU_ITEM_DUPLICADO');
      }
      throw error;
    }
  }

  function getConfig() {
    const generators = Object.fromEntries(
      DOPAMINE_GENERATORS.map((generator) => [
        generator.key,
        { label: generator.label, enabled: true }
      ])
    );
    for (const row of db.all('SELECT feature_key, enabled FROM dopamine_config')) {
      if (generators[row.feature_key]) generators[row.feature_key].enabled = Boolean(row.enabled);
    }

    const ai = Object.fromEntries(AI_REWARD_KEYS.map((key) => [key, false]));
    for (const row of db.all('SELECT key, value FROM ai_reward_config')) {
      if (Object.hasOwn(ai, row.key)) ai[row.key] = Boolean(row.value);
    }
    return { generators, ai };
  }

  function setGeneratorEnabled(inputValue) {
    const input = parseServiceInput(
      generatorConfigSchema,
      inputValue,
      'Revise a configuração do gerador.',
      'GERADOR_VALIDACAO_FALHOU'
    );
    return db.transaction((transactionDb) => {
      transactionDb.run(
        `UPDATE dopamine_config
         SET enabled = ?, updated_at = CURRENT_TIMESTAMP
         WHERE feature_key = ?`,
        [input.enabled ? 1 : 0, input.key]
      );
      return { key: input.key, enabled: input.enabled };
    });
  }

  function setAiFlag(inputValue) {
    const input = parseServiceInput(
      aiRewardConfigSchema,
      inputValue,
      'Revise a configuração inteligente.',
      'RECOMPENSA_IA_VALIDACAO_FALHOU'
    );
    return db.transaction((transactionDb) => {
      transactionDb.run(
        `UPDATE ai_reward_config
         SET value = ?, updated_at = CURRENT_TIMESTAMP
         WHERE key = ?`,
        [input.value ? 1 : 0, input.key]
      );
      return { key: input.key, value: input.value };
    });
  }

  function getExecutiveDashboard() {
    const top10 = db.all(`
      SELECT users.id, users.name, users.email, users.plan,
             gamification.total_completions, gamification.coins,
             gamification.current_streak, gamification.longest_streak
      FROM user_gamification AS gamification
      JOIN users ON users.id = gamification.user_id
      ORDER BY gamification.total_completions DESC, gamification.coins DESC
      LIMIT 10
    `);

    const generators = db.all(`
      SELECT events.generator,
             COUNT(events.id) AS usos,
             COALESCE(ROUND(AVG(feedback.rating), 2), 0) AS satisfacao_media,
             COALESCE(SUM(events.coins), 0) AS moedas_geradas
      FROM reward_events AS events
      LEFT JOIN reward_feedback AS feedback ON feedback.reward_event_id = events.id
      GROUP BY events.generator
      ORDER BY usos DESC, events.generator ASC
    `);

    const preferencias = db.all(`
      SELECT generator, COUNT(*) AS avaliacoes, ROUND(AVG(rating), 2) AS media
      FROM reward_feedback
      GROUP BY generator
      ORDER BY media DESC, generator ASC
    `);

    const cohort = db.get(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_active = 1) AS total_usuarios,
        (SELECT COUNT(DISTINCT user_id) FROM reward_events WHERE created_at >= datetime('now', '-1 day')) AS ativos_d1,
        (SELECT COUNT(DISTINCT user_id) FROM reward_events WHERE created_at >= datetime('now', '-7 day')) AS ativos_d7,
        (SELECT COUNT(DISTINCT user_id) FROM reward_events WHERE created_at >= datetime('now', '-30 day')) AS ativos_d30
    `);

    const churn = db.all(`
      SELECT users.id, users.name, users.email, MAX(events.created_at) AS ultima_atividade
      FROM users
      LEFT JOIN reward_events AS events ON events.user_id = users.id
      WHERE users.is_active = 1
      GROUP BY users.id, users.name, users.email
      HAVING ultima_atividade IS NULL OR ultima_atividade < datetime('now', '-7 day')
      ORDER BY ultima_atividade ASC, users.id ASC
      LIMIT 10
    `);

    const abTesting = db.all(`
      SELECT events.tier, COUNT(events.id) AS ocorrencias,
             COALESCE(ROUND(AVG(feedback.rating), 2), 0) AS satisfacao
      FROM reward_events AS events
      LEFT JOIN reward_feedback AS feedback ON feedback.reward_event_id = events.id
      GROUP BY events.tier
      ORDER BY satisfacao DESC, events.tier ASC
    `);

    const rfm = db.all(`
      SELECT users.name, users.email,
        CAST(julianday('now') - julianday(COALESCE(MAX(events.created_at), users.created_at)) AS INTEGER) AS recencia_dias,
        gamification.total_completions AS frequencia,
        gamification.coins AS valor_moedas
      FROM users
      JOIN user_gamification AS gamification ON gamification.user_id = users.id
      LEFT JOIN reward_events AS events ON events.user_id = users.id
      GROUP BY users.id, users.name, users.email, users.created_at,
               gamification.total_completions, gamification.coins
      ORDER BY valor_moedas DESC, users.id ASC
      LIMIT 10
    `);

    const totals = db.get(`
      SELECT
        (SELECT COUNT(*) FROM reward_events) AS total_recompensas,
        (SELECT COALESCE(SUM(coins), 0) FROM reward_events) AS total_moedas,
        (SELECT COUNT(*) FROM reward_events WHERE jackpot = 1) AS total_jackpots,
        (SELECT COALESCE(ROUND(AVG(rating), 2), 0) FROM reward_feedback) AS satisfacao_geral
    `);

    const dau = Number(cohort.ativos_d1);
    const mau = Number(cohort.ativos_d30);
    return {
      top10,
      generators,
      preferencias,
      metricas: {
        retencao: {
          d1: dau,
          d7: Number(cohort.ativos_d7),
          d30: mau,
          total: Number(cohort.total_usuarios)
        },
        stickiness: {
          dau,
          mau,
          indice: mau > 0 ? Math.round((dau / mau) * 100) : 0
        },
        churn,
        ab_testing: abTesting,
        rfm
      },
      totais: {
        total_recompensas: Number(totals.total_recompensas),
        total_moedas: Number(totals.total_moedas),
        total_jackpots: Number(totals.total_jackpots),
        satisfacao_geral: Number(totals.satisfacao_geral)
      }
    };
  }

  return {
    addDopamenuItem,
    deleteDopamenuItem,
    getConfig,
    getDopamenu,
    getExecutiveDashboard,
    getState,
    registerCompletion,
    setAiFlag,
    setGeneratorEnabled,
    submitFeedback,
    updateDopamenuItem
  };
}
