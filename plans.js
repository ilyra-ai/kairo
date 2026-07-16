// ============================================================================
//  Kairo — Módulo de Gestão de Planos e Funcionalidades (Feature Flags)
//  Planos: free | plus | pro (o perfil "administrador" tem acesso total).
//  Matriz plano × funcionalidade com salvamento automático (sem botão salvar).
// ============================================================================

// Funcionalidades padrão do app (chave estável + rótulo legível)
const DEFAULT_FEATURES = [
  { key: 'dashboard',        label: 'Dashboard e cards' },
  { key: 'agenda',           label: 'Agenda multilayout' },
  { key: 'reports',          label: 'Relatórios e insights' },
  { key: 'pomodoro',         label: 'Modo foco Pomodoro' },
  { key: 'binaural',         label: 'Ondas binaurais 40 Hz' },
  { key: 'google_calendar',  label: 'Sincronização Google Agenda' },
  { key: 'themes',           label: 'Temas e personalização' },
  { key: 'ai_assistant',     label: 'Assistente de IA e chat' }
];

// Planos padrão
const DEFAULT_PLANS = [
  { key: 'free', name: 'Free', price: 0,    description: 'Para começar a organizar o seu tempo.' },
  { key: 'plus', name: 'Plus', price: 1900, description: 'Para quem leva a produtividade a sério.' },
  { key: 'pro',  name: 'Pro',  price: 3900, description: 'Máxima performance com IA.' }
];

// Permissões padrão por plano (true = liberado)
const DEFAULT_MATRIX = {
  free: ['dashboard', 'agenda', 'reports', 'pomodoro', 'themes'],
  plus: ['dashboard', 'agenda', 'reports', 'pomodoro', 'binaural', 'google_calendar', 'themes'],
  pro:  ['dashboard', 'agenda', 'reports', 'pomodoro', 'binaural', 'google_calendar', 'themes', 'ai_assistant']
};

export async function ensurePlansSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS plan_features (
      plan_key TEXT NOT NULL,
      feature_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (plan_key, feature_key)
    );
  `);

  // Seed de funcionalidades
  for (const f of DEFAULT_FEATURES) {
    await db.run('INSERT OR IGNORE INTO features (key, label) VALUES (?, ?)', [f.key, f.label]);
  }
  // Seed de planos
  for (const p of DEFAULT_PLANS) {
    await db.run(
      'INSERT OR IGNORE INTO plans (key, name, price, description) VALUES (?, ?, ?, ?)',
      [p.key, p.name, p.price, p.description]
    );
  }
  // Seed da matriz (apenas se ainda não houver registros)
  const count = await db.get('SELECT COUNT(*) as c FROM plan_features');
  if (count.c === 0) {
    for (const p of DEFAULT_PLANS) {
      for (const f of DEFAULT_FEATURES) {
        const enabled = DEFAULT_MATRIX[p.key] && DEFAULT_MATRIX[p.key].includes(f.key) ? 1 : 0;
        await db.run(
          'INSERT OR REPLACE INTO plan_features (plan_key, feature_key, enabled) VALUES (?, ?, ?)',
          [p.key, f.key, enabled]
        );
      }
    }
  }
}

// Retorna planos, funcionalidades e a matriz completa
export async function getPlansMatrix(db) {
  const plans = await db.all('SELECT key, name, price, description FROM plans ORDER BY price ASC');
  const features = await db.all('SELECT key, label FROM features ORDER BY id ASC');
  const rows = await db.all('SELECT plan_key, feature_key, enabled FROM plan_features');
  const matrix = {};
  for (const p of plans) matrix[p.key] = {};
  for (const r of rows) {
    if (!matrix[r.plan_key]) matrix[r.plan_key] = {};
    matrix[r.plan_key][r.feature_key] = !!r.enabled;
  }
  return { plans, features, matrix };
}

// Liga/desliga uma funcionalidade em um plano (salvamento automático)
export async function toggleFeature(db, planKey, featureKey, enabled) {
  await db.run(
    'INSERT OR REPLACE INTO plan_features (plan_key, feature_key, enabled) VALUES (?, ?, ?)',
    [planKey, featureKey, enabled ? 1 : 0]
  );
  return { plan_key: planKey, feature_key: featureKey, enabled: !!enabled };
}

// Verifica se um plano tem acesso a uma funcionalidade (admin sempre true)
export async function planCan(db, planKey, featureKey) {
  if (planKey === 'administrador') return true;
  const row = await db.get(
    'SELECT enabled FROM plan_features WHERE plan_key = ? AND feature_key = ?',
    [planKey, featureKey]
  );
  return row ? !!row.enabled : false;
}

// CRUD de planos
export async function createPlan(db, { key, name, price, description }) {
  if (!key || !name) throw new Error('Chave e nome do plano são obrigatórios.');
  const exists = await db.get('SELECT id FROM plans WHERE key = ?', [key]);
  if (exists) throw new Error('Já existe um plano com esta chave.');
  await db.run(
    'INSERT INTO plans (key, name, price, description) VALUES (?, ?, ?, ?)',
    [key, name, price || 0, description || '']
  );
  // Inicializa a matriz do novo plano (tudo desligado)
  const features = await db.all('SELECT key FROM features');
  for (const f of features) {
    await db.run('INSERT OR IGNORE INTO plan_features (plan_key, feature_key, enabled) VALUES (?, ?, 0)', [key, f.key]);
  }
  return await db.get('SELECT key, name, price, description FROM plans WHERE key = ?', [key]);
}

export async function updatePlan(db, key, { name, price, description }) {
  const plan = await db.get('SELECT * FROM plans WHERE key = ?', [key]);
  if (!plan) throw new Error('Plano não encontrado.');
  await db.run(
    'UPDATE plans SET name = ?, price = ?, description = ? WHERE key = ?',
    [name !== undefined ? name : plan.name, price !== undefined ? price : plan.price,
     description !== undefined ? description : plan.description, key]
  );
  return await db.get('SELECT key, name, price, description FROM plans WHERE key = ?', [key]);
}

export async function deletePlan(db, key) {
  if (['free', 'plus', 'pro'].includes(key)) throw new Error('Os planos padrão (Free, Plus, Pro) não podem ser excluídos.');
  await db.run('DELETE FROM plans WHERE key = ?', [key]);
  await db.run('DELETE FROM plan_features WHERE plan_key = ?', [key]);
}

// CRUD de funcionalidades
export async function createFeature(db, { key, label }) {
  if (!key || !label) throw new Error('Chave e rótulo da funcionalidade são obrigatórios.');
  const exists = await db.get('SELECT id FROM features WHERE key = ?', [key]);
  if (exists) throw new Error('Já existe uma funcionalidade com esta chave.');
  await db.run('INSERT INTO features (key, label) VALUES (?, ?)', [key, label]);
  // Adiciona a nova funcionalidade a todos os planos (desligada)
  const plans = await db.all('SELECT key FROM plans');
  for (const p of plans) {
    await db.run('INSERT OR IGNORE INTO plan_features (plan_key, feature_key, enabled) VALUES (?, ?, 0)', [p.key, key]);
  }
  return await db.get('SELECT key, label FROM features WHERE key = ?', [key]);
}

export async function deleteFeature(db, key) {
  await db.run('DELETE FROM features WHERE key = ?', [key]);
  await db.run('DELETE FROM plan_features WHERE feature_key = ?', [key]);
}
