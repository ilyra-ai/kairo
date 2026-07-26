// ============================================================================
// Kairo — Integração do Orçamento de Energia (Tarefa 35.1)
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ensureCoreSchema,
  ensureUserWorkspace,
  openSqliteClient
} from '../../src/server/database/index.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';
import { createSmartFeaturesService } from '../../src/server/modules/smart/smart-features.service.js';
import { createEnergyBudgetService } from '../../src/server/modules/smart/energy-budget.service.js';

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-orcamento-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-orcamento-com-mais-de-trinta-e-dois-bytes-2026',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const budget = createEnergyBudgetService({ db, smartFeaturesService: smart });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, smart, budget };
}

async function prepararUsuarioComEventos(context, dia) {
  await context.auth.register({ name: 'Titular', email: 'u@k.local', password: 'senha-teste' });
  const atividade = context.db.get('SELECT id FROM activities WHERE user_id = 1 LIMIT 1');
  const inserir = (title, carga, ini, fim) =>
    context.db.run(
      `INSERT INTO agenda_events
        (user_id, activity_id, title, description, event_date, start_time, end_time,
         duration_hours, is_completed, priority, cognitive_load, event_color)
       VALUES (1, ?, ?, '', ?, ?, ?, 1, 0, 'media', ?, NULL)`,
      [atividade.id, title, dia, ini, fim, carga]
    );
  inserir('Leve', 1, '09:00', '10:00');
  inserir('Intensa', 3, '10:00', '11:00');
  inserir('Média', 2, '11:00', '12:00');
  return { userId: 1 };
}

test('recurso desativado bloqueia o cálculo do orçamento', async (t) => {
  const context = criarContexto(t);
  await prepararUsuarioComEventos(context, '2026-07-21');
  assert.throws(
    () => context.budget.computeDay(1, '2026-07-21'),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('consumo bate com a carga cognitiva real dos eventos', async (t) => {
  const context = criarContexto(t);
  await prepararUsuarioComEventos(context, '2026-07-21');
  context.smart.updateConfig('energy_budget', { enabled: true }, 1);

  const r = context.budget.computeDay(1, '2026-07-21');
  // Pesos padrão: leve=1, média=2, intensa=3 → consumo = 1 + 3 + 2 = 6.
  assert.equal(r.consumed, 6);
  assert.equal(r.budget, 12);
  assert.equal(r.overloaded, false);
  assert.equal(r.events.length, 3);
});

test('avisa sobrecarga quando ultrapassa o orçamento (limiar admin)', async (t) => {
  const context = criarContexto(t);
  await prepararUsuarioComEventos(context, '2026-07-21');
  // Admin reduz o orçamento base para 5 → consumo 6 excede.
  context.smart.updateConfig('energy_budget', { enabled: true, params: { orcamento_base: 5 } }, 1);

  const r = context.budget.computeDay(1, '2026-07-21');
  assert.equal(r.budget, 5);
  assert.equal(r.consumed, 6);
  assert.equal(r.overloaded, true);

  // Projeção antes de agendar: adicionar carga intensa agravaria a sobrecarga.
  const proj = context.budget.wouldOverload(1, '2026-07-21', 3);
  assert.equal(proj.would_overload, true);
  assert.equal(proj.projected, 9);
});

test('persiste o orçamento e calibra pelo histórico real de energia', async (t) => {
  const context = criarContexto(t);
  await prepararUsuarioComEventos(context, '2026-07-21');
  context.smart.updateConfig('energy_budget', { enabled: true }, 1);
  for (let index = 0; index < 8; index += 1) {
    context.db.run(
      `INSERT INTO energy_logs (user_id, level, context, logged_date, logged_hour)
       VALUES (1, 5, 'manha', '2026-07-21', ?)`,
      [index + 8]
    );
  }

  const calibrated = context.budget.computeDay(1, '2026-07-21');
  assert.equal(calibrated.source, 'historico_energia');
  assert.equal(calibrated.budget, 15);
  const persisted = context.db.get(
    "SELECT * FROM energy_budgets WHERE user_id = 1 AND budget_date = '2026-07-21'"
  );
  assert.equal(persisted.consumed, 6);

  const manual = context.budget.setDailyBudget(1, { date: '2026-07-21', budget: 9 });
  assert.equal(manual.budget, 9);
  assert.equal(manual.source, 'manual');
});
