// ============================================================================
// Kairo — Integração de Pagamentos e aplicação real dos planos (Tarefa 13)
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
import {
  createPlansService,
  ensurePlansSchema
} from '../../src/server/modules/plans/plans.service.js';
import { createPaymentsService } from '../../src/server/modules/payments/payments.service.js';

const SECRET = 'segredo-webhook-kairo-com-mais-de-trinta-e-dois-bytes';

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-pagamentos-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-pagamentos-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const plans = createPlansService(db);
  const payments = createPaymentsService({ db, plansService: plans, webhookSecret: SECRET });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, plans, payments };
}

function planoDoUsuario(db, userId) {
  return db.get('SELECT plan FROM users WHERE id = ?', [userId]).plan;
}

test('listPlans marca apenas planos pagos como payable', async (t) => {
  const context = criarContexto(t);
  const planos = context.payments.listPlans();
  const free = planos.find((p) => p.key === 'free');
  const plus = planos.find((p) => p.key === 'plus');
  assert.equal(free.payable, false);
  assert.equal(plus.payable, true);
  assert.ok(plus.price_cents > 0);
});

test('checkout do plano Free é rejeitado', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  assert.throws(
    () => context.payments.createCheckout(1, { plan_key: 'free', provider: 'manual' }),
    (e) => e.code === 'PLANO_GRATUITO'
  );
});

test('webhook assinado aplica o plano de verdade e é idempotente', async (t) => {
  const context = criarContexto(t);
  // Segundo usuário para não ser o admin/pro do bootstrap.
  await context.auth.register({ name: 'A', email: 'a@k.local', password: 'senha-teste' });
  await context.auth.register({ name: 'B', email: 'b@k.local', password: 'senha-teste' });
  const userId = context.db.get('SELECT id FROM users WHERE email = ?', ['b@k.local']).id;
  assert.equal(planoDoUsuario(context.db, userId), 'free');

  const checkout = context.payments.createCheckout(userId, {
    plan_key: 'plus',
    provider: 'manual'
  });
  const evento = {
    event_id: 'evt_1',
    type: 'payment.succeeded',
    external_ref: checkout.external_ref,
    status: 'paid'
  };
  const assinatura = context.payments.signEvent(evento);

  const r1 = context.payments.handleWebhook('manual', evento, assinatura);
  assert.equal(r1.processed, true);
  assert.equal(r1.effect, 'plano_aplicado');
  assert.equal(planoDoUsuario(context.db, userId), 'plus');

  // Reenvio do mesmo evento não duplica efeito (idempotência).
  const r2 = context.payments.handleWebhook('manual', evento, assinatura);
  assert.equal(r2.processed, false);
  assert.equal(planoDoUsuario(context.db, userId), 'plus');
});

test('webhook com assinatura inválida é rejeitado', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'A', email: 'a@k.local', password: 'senha-teste' });
  const userId = context.db.get('SELECT id FROM users WHERE email = ?', ['a@k.local']).id;
  const checkout = context.payments.createCheckout(userId, {
    plan_key: 'plus',
    provider: 'manual'
  });
  const evento = {
    event_id: 'evt_x',
    type: 'payment.succeeded',
    external_ref: checkout.external_ref,
    status: 'paid'
  };
  assert.throws(
    () => context.payments.handleWebhook('manual', evento, 'deadbeef'),
    (e) => e.code === 'ASSINATURA_INVALIDA'
  );
});

test('cancelamento reverte o usuário para o plano Free', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'A', email: 'a@k.local', password: 'senha-teste' });
  await context.auth.register({ name: 'B', email: 'b@k.local', password: 'senha-teste' });
  const userId = context.db.get('SELECT id FROM users WHERE email = ?', ['b@k.local']).id;

  const checkout = context.payments.createCheckout(userId, { plan_key: 'pro', provider: 'manual' });
  const evento = {
    event_id: 'evt_pro',
    type: 'payment.succeeded',
    external_ref: checkout.external_ref,
    status: 'paid'
  };
  context.payments.handleWebhook('manual', evento, context.payments.signEvent(evento));
  assert.equal(planoDoUsuario(context.db, userId), 'pro');

  const cancelamento = context.payments.cancel(userId);
  assert.equal(cancelamento.plan, 'free');
  assert.equal(planoDoUsuario(context.db, userId), 'free');
});
