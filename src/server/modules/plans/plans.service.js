// ============================================================================
// Kairo — Serviço de planos, funcionalidades e autorização por recurso
// ============================================================================

import { conflict, notFound } from '../../shared/http-error.js';

const DEFAULT_FEATURES = Object.freeze([
  { key: 'dashboard', label: 'Dashboard e cards' },
  { key: 'agenda', label: 'Agenda multilayout' },
  { key: 'reports', label: 'Relatórios e insights' },
  { key: 'pomodoro', label: 'Modo foco Pomodoro' },
  { key: 'binaural', label: 'Ondas binaurais 40 Hz' },
  { key: 'google_calendar', label: 'Sincronização Google Agenda' },
  { key: 'themes', label: 'Temas e personalização' },
  { key: 'ai_assistant', label: 'Assistente de IA e chat' }
]);

const DEFAULT_PLANS = Object.freeze([
  { key: 'free', name: 'Free', price: 0, description: 'Para começar a organizar o seu tempo.' },
  { key: 'plus', name: 'Plus', price: 1900, description: 'Para quem leva a produtividade a sério.' },
  { key: 'pro', name: 'Pro', price: 3900, description: 'Máxima performance com IA.' }
]);

const DEFAULT_MATRIX = Object.freeze({
  free: new Set(['dashboard', 'agenda', 'reports', 'pomodoro', 'themes']),
  plus: new Set(['dashboard', 'agenda', 'reports', 'pomodoro', 'binaural', 'google_calendar', 'themes']),
  pro: new Set(DEFAULT_FEATURES.map((feature) => feature.key))
});

function tableExists(db, tableName) {
  return Boolean(db.get(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  ));
}

function createPlanFeatureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_features (
      plan_key TEXT NOT NULL,
      feature_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      PRIMARY KEY (plan_key, feature_key),
      FOREIGN KEY (plan_key) REFERENCES plans (key) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (feature_key) REFERENCES features (key) ON UPDATE CASCADE ON DELETE CASCADE
    );
  `);
}

function ensurePlanFeatureForeignKeys(db) {
  if (!tableExists(db, 'plan_features')) {
    createPlanFeatureTable(db);
    return;
  }
  const foreignKeys = db.all('PRAGMA foreign_key_list(plan_features)');
  const targets = new Set(foreignKeys.map((foreignKey) => foreignKey.table));
  if (targets.has('plans') && targets.has('features')) return;

  db.transaction(() => {
    db.exec('ALTER TABLE plan_features RENAME TO plan_features_legacy');
    createPlanFeatureTable(db);
    db.exec(`
      INSERT INTO plan_features (plan_key, feature_key, enabled)
      SELECT legacy.plan_key, legacy.feature_key,
             CASE WHEN legacy.enabled = 1 THEN 1 ELSE 0 END
      FROM plan_features_legacy legacy
      JOIN plans ON plans.key = legacy.plan_key
      JOIN features ON features.key = legacy.feature_key;
      DROP TABLE plan_features_legacy;
    `);
  });
}

export function ensurePlansSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
      description TEXT NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const planColumns = new Set(db.all('PRAGMA table_info(plans)').map((column) => column.name));
  if (!planColumns.has('updated_at')) {
    db.exec('ALTER TABLE plans ADD COLUMN updated_at DATETIME DEFAULT NULL');
    db.run('UPDATE plans SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)');
  }

  ensurePlanFeatureForeignKeys(db);

  db.transaction(() => {
    for (const feature of DEFAULT_FEATURES) {
      db.run('INSERT OR IGNORE INTO features (key, label) VALUES (?, ?)', [feature.key, feature.label]);
    }
    for (const plan of DEFAULT_PLANS) {
      db.run(
        'INSERT OR IGNORE INTO plans (key, name, price, description) VALUES (?, ?, ?, ?)',
        [plan.key, plan.name, plan.price, plan.description]
      );
    }
    for (const plan of DEFAULT_PLANS) {
      for (const feature of DEFAULT_FEATURES) {
        db.run(
          `INSERT OR IGNORE INTO plan_features (plan_key, feature_key, enabled)
           VALUES (?, ?, ?)`,
          [plan.key, feature.key, DEFAULT_MATRIX[plan.key].has(feature.key) ? 1 : 0]
        );
      }
    }
    if (tableExists(db, 'profile_data')) {
      db.run(`
        UPDATE profile_data
        SET focus_sound = 'nenhum', updated_at = CURRENT_TIMESTAMP
        WHERE focus_sound = 'binaural'
          AND EXISTS (
            SELECT 1
            FROM users
            WHERE users.id = profile_data.user_id
              AND users.role <> 'administrador'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM users
            INNER JOIN plan_features
              ON plan_features.plan_key = users.plan
             AND plan_features.feature_key = 'binaural'
             AND plan_features.enabled = 1
            WHERE users.id = profile_data.user_id
          )
      `);
    }
  });
}

export function createPlansService(db) {
  function getMatrix() {
    const plans = db.all('SELECT key, name, price, description FROM plans ORDER BY price ASC, id ASC');
    const features = db.all('SELECT key, label FROM features ORDER BY id ASC');
    const rows = db.all('SELECT plan_key, feature_key, enabled FROM plan_features');
    const matrix = Object.fromEntries(plans.map((plan) => [plan.key, {}]));
    for (const row of rows) {
      if (!matrix[row.plan_key]) matrix[row.plan_key] = {};
      matrix[row.plan_key][row.feature_key] = Boolean(row.enabled);
    }
    return { plans, features, matrix };
  }

  function toggleFeature({ plan_key: planKey, feature_key: featureKey, enabled }) {
    if (!db.get('SELECT 1 AS found FROM plans WHERE key = ?', [planKey])) {
      throw notFound('Plano não encontrado.', 'PLANO_NAO_ENCONTRADO');
    }
    if (!db.get('SELECT 1 AS found FROM features WHERE key = ?', [featureKey])) {
      throw notFound('Funcionalidade não encontrada.', 'FUNCIONALIDADE_NAO_ENCONTRADA');
    }
    return db.transaction(() => {
      db.run(
        `INSERT INTO plan_features (plan_key, feature_key, enabled)
         VALUES (?, ?, ?)
         ON CONFLICT(plan_key, feature_key) DO UPDATE SET enabled = excluded.enabled`,
        [planKey, featureKey, enabled ? 1 : 0]
      );
      let normalizedProfiles = 0;
      if (!enabled && featureKey === 'binaural' && tableExists(db, 'profile_data')) {
        normalizedProfiles = db.run(
          `UPDATE profile_data
           SET focus_sound = 'nenhum', updated_at = CURRENT_TIMESTAMP
           WHERE focus_sound = 'binaural'
             AND user_id IN (
               SELECT id
               FROM users
               WHERE plan = ? AND role <> 'administrador'
             )`,
          [planKey]
        ).changes;
      }
      return {
        plan_key: planKey,
        feature_key: featureKey,
        enabled,
        normalized_profiles: normalizedProfiles
      };
    });
  }

  function planCan(planKey, featureKey, role = 'usuario') {
    if (role === 'administrador') return true;
    return Boolean(db.get(
      `SELECT 1 AS allowed FROM plan_features
       WHERE plan_key = ? AND feature_key = ? AND enabled = 1`,
      [planKey, featureKey]
    ));
  }

  function createPlan(input) {
    if (db.get('SELECT 1 AS found FROM plans WHERE key = ?', [input.key])) {
      throw conflict('Já existe um plano com esta chave.', 'PLANO_DUPLICADO');
    }
    return db.transaction(() => {
      db.run(
        'INSERT INTO plans (key, name, price, description) VALUES (?, ?, ?, ?)',
        [input.key, input.name, input.price, input.description]
      );
      for (const feature of db.all('SELECT key FROM features')) {
        db.run(
          'INSERT INTO plan_features (plan_key, feature_key, enabled) VALUES (?, ?, 0)',
          [input.key, feature.key]
        );
      }
      return db.get('SELECT key, name, price, description FROM plans WHERE key = ?', [input.key]);
    });
  }

  function updatePlan(key, input) {
    const current = db.get('SELECT * FROM plans WHERE key = ?', [key]);
    if (!current) throw notFound('Plano não encontrado.', 'PLANO_NAO_ENCONTRADO');
    db.run(
      `UPDATE plans SET name = ?, price = ?, description = ?, updated_at = CURRENT_TIMESTAMP
       WHERE key = ?`,
      [
        input.name ?? current.name,
        input.price ?? current.price,
        input.description ?? current.description,
        key
      ]
    );
    return db.get('SELECT key, name, price, description FROM plans WHERE key = ?', [key]);
  }

  function deletePlan(key) {
    if (DEFAULT_PLANS.some((plan) => plan.key === key)) {
      throw conflict('Os planos padrão não podem ser excluídos.', 'PLANO_PADRAO_PROTEGIDO');
    }
    if (!db.get('SELECT 1 AS found FROM plans WHERE key = ?', [key])) {
      throw notFound('Plano não encontrado.', 'PLANO_NAO_ENCONTRADO');
    }
    const assigned = Number(db.get('SELECT COUNT(*) AS total FROM users WHERE plan = ?', [key]).total);
    if (assigned > 0) {
      throw conflict('Transfira os usuários deste plano antes de excluí-lo.', 'PLANO_EM_USO');
    }
    db.run('DELETE FROM plans WHERE key = ?', [key]);
  }

  function createFeature(input) {
    if (db.get('SELECT 1 AS found FROM features WHERE key = ?', [input.key])) {
      throw conflict('Já existe uma funcionalidade com esta chave.', 'FUNCIONALIDADE_DUPLICADA');
    }
    return db.transaction(() => {
      db.run('INSERT INTO features (key, label) VALUES (?, ?)', [input.key, input.label]);
      for (const plan of db.all('SELECT key FROM plans')) {
        db.run(
          'INSERT INTO plan_features (plan_key, feature_key, enabled) VALUES (?, ?, 0)',
          [plan.key, input.key]
        );
      }
      return db.get('SELECT key, label FROM features WHERE key = ?', [input.key]);
    });
  }

  function deleteFeature(key) {
    if (DEFAULT_FEATURES.some((feature) => feature.key === key)) {
      throw conflict('As funcionalidades padrão não podem ser excluídas.', 'FUNCIONALIDADE_PADRAO_PROTEGIDA');
    }
    const result = db.run('DELETE FROM features WHERE key = ?', [key]);
    if (result.changes === 0) {
      throw notFound('Funcionalidade não encontrada.', 'FUNCIONALIDADE_NAO_ENCONTRADA');
    }
  }

  return {
    createFeature,
    createPlan,
    deleteFeature,
    deletePlan,
    getMatrix,
    planCan,
    toggleFeature,
    updatePlan
  };
}
