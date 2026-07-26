// ============================================================================
// Kairo — Integração Stripe real com cliente controlado e persistência SQLite
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

const ENCRYPTION_KEY = Buffer.alloc(32, 19);
const WEBHOOK_SECRET = 'whsec_kairo_testes_assinados';
const PRICE_PLUS = 'price_plus_kairo';
const PRICE_PRO = 'price_pro_kairo';
const BASE_TIME = 1_787_000_000;

function price(id, amount, livemode = false) {
  return {
    id,
    active: true,
    type: 'recurring',
    currency: 'brl',
    unit_amount: amount,
    livemode,
    recurring: { interval: 'month' }
  };
}

function createStripeDouble() {
  const state = {
    customerSequence: 0,
    checkoutSequence: 0,
    portalSequence: 0,
    customers: new Map(),
    sessions: new Map(),
    subscriptions: new Map(),
    invoices: new Map(),
    charges: new Map(),
    checkoutCreateCalls: [],
    checkoutExpireCalls: [],
    subscriptionUpdateCalls: [],
    subscriptionCancelCalls: []
  };

  const client = {
    accounts: {
      async retrieve() {
        return { id: 'acct_kairo_test' };
      }
    },
    prices: {
      async retrieve(id) {
        if (id === PRICE_PLUS) return price(id, 1900);
        if (id === PRICE_PRO) return price(id, 3900);
        const error = new Error('Preço não encontrado.');
        error.code = 'resource_missing';
        throw error;
      }
    },
    customers: {
      async create(payload) {
        const customer = { id: `cus_test_${++state.customerSequence}`, ...payload };
        state.customers.set(customer.id, customer);
        return customer;
      }
    },
    checkout: {
      sessions: {
        async create(payload, options) {
          const id = `cs_test_${++state.checkoutSequence}`;
          const session = {
            id,
            url: `https://checkout.stripe.com/c/pay/${id}`,
            status: 'open',
            mode: payload.mode,
            customer: payload.customer,
            client_reference_id: payload.client_reference_id,
            metadata: payload.metadata,
            subscription: null,
            expires_at: BASE_TIME + 3600
          };
          state.checkoutCreateCalls.push({ payload, options });
          state.sessions.set(id, session);
          return session;
        },
        async retrieve(id) {
          const session = state.sessions.get(id);
          if (!session) {
            const error = new Error('Checkout não encontrado.');
            error.code = 'resource_missing';
            throw error;
          }
          return session;
        },
        async expire(id) {
          const session = state.sessions.get(id);
          if (!session) {
            const error = new Error('Checkout não encontrado.');
            error.code = 'resource_missing';
            throw error;
          }
          session.status = 'expired';
          state.checkoutExpireCalls.push(id);
          return session;
        }
      }
    },
    billingPortal: {
      sessions: {
        async create(payload) {
          state.portalSequence += 1;
          return {
            id: `bps_${state.portalSequence}`,
            url: `https://billing.stripe.com/p/session/${state.portalSequence}`,
            ...payload
          };
        }
      }
    },
    subscriptions: {
      async retrieve(id) {
        const subscription = state.subscriptions.get(id);
        if (!subscription) {
          const error = new Error('Assinatura não encontrada.');
          error.code = 'resource_missing';
          throw error;
        }
        return subscription;
      },
      async update(id, payload) {
        const subscription = await client.subscriptions.retrieve(id);
        Object.assign(subscription, payload);
        state.subscriptionUpdateCalls.push({ id, payload });
        return subscription;
      },
      async cancel(id) {
        const subscription = await client.subscriptions.retrieve(id);
        subscription.status = 'canceled';
        subscription.cancel_at_period_end = false;
        state.subscriptionCancelCalls.push(id);
        return subscription;
      }
    },
    invoices: {
      async retrieve(id) {
        const invoice = state.invoices.get(id);
        if (!invoice) {
          const error = new Error('Fatura não encontrada.');
          error.code = 'resource_missing';
          throw error;
        }
        return invoice;
      }
    },
    charges: {
      async retrieve(id) {
        const charge = state.charges.get(id);
        if (!charge) {
          const error = new Error('Cobrança não encontrada.');
          error.code = 'resource_missing';
          throw error;
        }
        return charge;
      }
    },
    webhooks: {
      constructEvent(rawBody, signature, secret) {
        if (signature !== 'stripe-signature-valid' || secret !== WEBHOOK_SECRET) {
          throw new Error('Assinatura inválida.');
        }
        return JSON.parse(rawBody.toString('utf8'));
      }
    }
  };

  return { client, state };
}

function environment(overrides = {}) {
  return {
    enabled: true,
    mode: 'test',
    secretKey: 'rk_test_kairo_restricted_key',
    webhookSecret: WEBHOOK_SECRET,
    publicBaseUrl: 'http://127.0.0.1:3000',
    prices: { plus: PRICE_PLUS, pro: PRICE_PRO },
    ...overrides
  };
}

function createContext(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-stripe-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-pagamentos-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3_600_000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const plans = createPlansService(db);
  const stripe = createStripeDouble();
  const payments = createPaymentsService({
    db,
    plansService: plans,
    encryptionKey: ENCRYPTION_KEY,
    environment: options.environment || environment(),
    stripeClientFactory: () => stripe.client,
    now: () => new Date(BASE_TIME * 1000)
  });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, plans, payments, stripe };
}

async function createRegularUser(context, suffix = 'pessoa') {
  await context.auth.register({
    name: 'Administrador de teste',
    email: `admin-${suffix}@kairo.local`,
    password: 'senha-teste-segura'
  });
  await context.auth.register({
    name: 'Pessoa de teste',
    email: `${suffix}@kairo.local`,
    password: 'senha-teste-segura'
  });
  return context.db.get('SELECT id FROM users WHERE email = ?', [`${suffix}@kairo.local`]).id;
}

function planForUser(db, userId) {
  return db.get('SELECT plan FROM users WHERE id = ?', [userId]).plan;
}

function createSubscriptionFixture(context, checkout, userId, planKey = 'plus', overrides = {}) {
  const session = context.stripe.state.sessions.get(checkout.checkout_session_id);
  const priceId = planKey === 'pro' ? PRICE_PRO : PRICE_PLUS;
  const amount = planKey === 'pro' ? 3900 : 1900;
  const subscriptionId = overrides.subscriptionId || `sub_${planKey}_${userId}`;
  const invoiceId = overrides.invoiceId || `in_${planKey}_${userId}`;
  const invoice = {
    id: invoiceId,
    paid: overrides.paid ?? true,
    status: overrides.paid === false ? 'open' : 'paid',
    currency: 'brl',
    amount_due: amount,
    amount_paid: overrides.paid === false ? 0 : amount,
    customer: session.customer,
    subscription: subscriptionId,
    period_start: BASE_TIME,
    period_end: BASE_TIME + 30 * 86400,
    hosted_invoice_url: `https://invoice.stripe.com/i/${invoiceId}`,
    invoice_pdf: `https://pay.stripe.com/invoice/${invoiceId}/pdf`
  };
  const subscription = {
    id: subscriptionId,
    status: overrides.status || 'active',
    customer: session.customer,
    cancel_at_period_end: Boolean(overrides.cancel_at_period_end),
    latest_invoice: invoiceId,
    metadata: {
      kairo_user_id: String(userId),
      kairo_checkout_reference: checkout.checkout_id
    },
    items: {
      data: [
        {
          quantity: 1,
          price: price(priceId, amount),
          current_period_start: BASE_TIME,
          current_period_end: BASE_TIME + 30 * 86400
        }
      ]
    }
  };
  context.stripe.state.invoices.set(invoiceId, invoice);
  context.stripe.state.subscriptions.set(subscriptionId, subscription);
  session.status = 'complete';
  session.subscription = { ...subscription, latest_invoice: invoice };
  return { session, subscription, invoice };
}

function event(type, object, id, created = BASE_TIME) {
  return Buffer.from(
    JSON.stringify({ id, type, livemode: false, created, data: { object } }),
    'utf8'
  );
}

async function deliver(context, type, object, id, created = BASE_TIME) {
  return context.payments.handleStripeWebhook(
    event(type, object, id, created),
    'stripe-signature-valid'
  );
}

async function activatePlan(context, userId, planKey = 'plus') {
  const checkout = await context.payments.createCheckout(userId, { plan_key: planKey });
  const fixture = createSubscriptionFixture(context, checkout, userId, planKey);
  await deliver(context, 'invoice.paid', fixture.invoice, `evt_paid_${planKey}_${userId}`);
  return { checkout, ...fixture };
}

test('lista planos com disponibilidade honesta e recusa checkout Free', async (t) => {
  const context = createContext(t);
  const payload = context.payments.listPlans();
  assert.equal(payload.provider.available, true);
  assert.equal(payload.plans.find((plan) => plan.key === 'free').payable, false);
  assert.equal(payload.plans.find((plan) => plan.key === 'plus').checkout_available, true);
  const userId = await createRegularUser(context, 'free');
  await assert.rejects(
    context.payments.createCheckout(userId, { plan_key: 'free' }),
    (error) => error.code === 'PLANO_GRATUITO'
  );
});

test('checkout usa Billing, Price conhecido, chave idempotente e identificador Dahlia', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'checkout');
  const result = await context.payments.createCheckout(userId, { plan_key: 'plus' });
  assert.match(result.url, /^https:\/\/checkout\.stripe\.com\//);
  const call = context.stripe.state.checkoutCreateCalls[0];
  assert.equal(call.payload.mode, 'subscription');
  assert.deepEqual(call.payload.line_items, [{ price: PRICE_PLUS, quantity: 1 }]);
  assert.match(call.payload.integration_identifier, /^kairo_checkout_[a-z]{8}$/);
  assert.equal('payment_method_types' in call.payload, false);
  assert.match(call.options.idempotencyKey, /^kairo-checkout-/);
});

test('checkout aberto do mesmo plano é reutilizado e outro plano encerra o anterior', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'concorrencia');
  const plus = await context.payments.createCheckout(userId, { plan_key: 'plus' });
  const reused = await context.payments.createCheckout(userId, { plan_key: 'plus' });
  assert.equal(reused.checkout_session_id, plus.checkout_session_id);
  assert.equal(reused.reused, true);
  const pro = await context.payments.createCheckout(userId, { plan_key: 'pro' });
  assert.notEqual(pro.checkout_session_id, plus.checkout_session_id);
  assert.deepEqual(context.stripe.state.checkoutExpireCalls, [plus.checkout_session_id]);
  assert.equal(
    context.db.get(
      "SELECT COUNT(*) AS total FROM checkout_sessions WHERE user_id = ? AND status IN ('creating', 'open')",
      [userId]
    ).total,
    1
  );
});

test('invoice.paid assinado concede o plano correto uma única vez', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'webhook');
  const checkout = await context.payments.createCheckout(userId, { plan_key: 'plus' });
  const fixture = createSubscriptionFixture(context, checkout, userId);
  const raw = event('invoice.paid', fixture.invoice, 'evt_paid_idempotent');
  const first = await context.payments.handleStripeWebhook(raw, 'stripe-signature-valid');
  const duplicate = await context.payments.handleStripeWebhook(raw, 'stripe-signature-valid');
  assert.equal(first.effect, 'acesso_concedido');
  assert.equal(duplicate.duplicate, true);
  assert.equal(planForUser(context.db, userId), 'plus');
  assert.equal(
    context.db.get(
      "SELECT COUNT(*) AS total FROM payment_events WHERE event_id = 'evt_paid_idempotent'"
    ).total,
    1
  );
});

test('webhook falha fechado sem assinatura válida ou configuração completa', async (t) => {
  const context = createContext(t);
  await assert.rejects(
    context.payments.handleStripeWebhook(event('invoice.paid', {}, 'evt_invalid'), 'invalida'),
    (error) => error.code === 'ASSINATURA_STRIPE_INVALIDA'
  );
  const disabled = createContext(t, {
    environment: environment({ webhookSecret: null })
  });
  await assert.rejects(
    disabled.payments.handleStripeWebhook(
      event('invoice.paid', {}, 'evt_without_secret'),
      'stripe-signature-valid'
    ),
    (error) => error.code === 'PAGAMENTOS_NAO_CONFIGURADOS'
  );
});

test('retorno do Checkout reconcilia a sessão vinculada mesmo antes do webhook', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'retorno');
  const checkout = await context.payments.createCheckout(userId, { plan_key: 'pro' });
  createSubscriptionFixture(context, checkout, userId, 'pro');
  const result = await context.payments.reconcileUser(userId, {
    checkout_session_id: checkout.checkout_session_id
  });
  assert.equal(result.checkout.confirmed, true);
  assert.equal(result.checkout.plan_key, 'pro');
  assert.equal(planForUser(context.db, userId), 'pro');
});

test('reconciliação Dahlia reconhece fatura status paid sem booleano legado paid', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'retorno-dahlia');
  const checkout = await context.payments.createCheckout(userId, { plan_key: 'plus' });
  const fixture = createSubscriptionFixture(context, checkout, userId, 'plus');
  delete fixture.invoice.paid;
  fixture.session.subscription.latest_invoice = fixture.invoice;

  const result = await context.payments.reconcileUser(userId, {
    checkout_session_id: checkout.checkout_session_id
  });

  assert.equal(result.checkout.confirmed, true);
  assert.equal(context.payments.getSubscription(userId).access_granted, 1);
  assert.equal(planForUser(context.db, userId), 'plus');
});

test('sessão de Checkout pertencente a outra conta é rejeitada', async (t) => {
  const context = createContext(t);
  const firstUserId = await createRegularUser(context, 'owner');
  await context.auth.register({
    name: 'Outra pessoa',
    email: 'other@kairo.local',
    password: 'senha-teste-segura'
  });
  const otherUserId = context.db.get("SELECT id FROM users WHERE email = 'other@kairo.local'").id;
  const checkout = await context.payments.createCheckout(firstUserId, { plan_key: 'plus' });
  createSubscriptionFixture(context, checkout, firstUserId);
  await assert.rejects(
    context.payments.reconcileUser(otherUserId, {
      checkout_session_id: checkout.checkout_session_id
    }),
    (error) => error.code === 'CHECKOUT_NAO_VINCULADO'
  );
});

test('mudança de Price revoga acesso até a fatura do upgrade ser paga', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'upgrade');
  const active = await activatePlan(context, userId, 'plus');
  active.subscription.items.data[0].price = price(PRICE_PRO, 3900);
  active.subscription.latest_invoice = 'in_upgrade_pending';
  context.stripe.state.invoices.set('in_upgrade_pending', {
    ...active.invoice,
    id: 'in_upgrade_pending',
    paid: false,
    status: 'open',
    amount_due: 3900,
    amount_paid: 0
  });
  await deliver(
    context,
    'customer.subscription.updated',
    active.subscription,
    'evt_upgrade',
    BASE_TIME + 1
  );
  assert.equal(planForUser(context.db, userId), 'free');
  const local = context.payments.getSubscription(userId);
  assert.equal(local.plan_key, 'pro');
  assert.equal(local.access_granted, 0);
});

test('fatura histórica fora de ordem não revoga a assinatura atual', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'ordering');
  const active = await activatePlan(context, userId, 'plus');
  const currentInvoice = { ...active.invoice, id: 'in_current_paid' };
  context.stripe.state.invoices.set(currentInvoice.id, currentInvoice);
  active.subscription.latest_invoice = currentInvoice.id;
  await deliver(context, 'invoice.paid', currentInvoice, 'evt_current_paid', BASE_TIME + 20);
  const staleVoid = { ...active.invoice, status: 'void', paid: false };
  const result = await deliver(
    context,
    'invoice.voided',
    staleVoid,
    'evt_stale_void',
    BASE_TIME + 10
  );
  assert.equal(result.effect, 'fatura_historica_registrada');
  assert.equal(planForUser(context.db, userId), 'plus');
  assert.equal(context.payments.getSubscription(userId).access_granted, 1);
});

test('cancelamento é remoto e mantém acesso até o fim do período pago', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'cancel');
  const active = await activatePlan(context, userId, 'plus');
  const result = await context.payments.cancel(userId);
  assert.equal(result.cancellation_scheduled, true);
  assert.equal(result.access_granted, true);
  assert.equal(planForUser(context.db, userId), 'plus');
  assert.deepEqual(context.stripe.state.subscriptionUpdateCalls, [
    { id: active.subscription.id, payload: { cancel_at_period_end: true } }
  ]);
});

test('desativar novas vendas preserva portal e impede apagar credenciais em uso', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'disable');
  await activatePlan(context, userId, 'plus');
  await context.payments.configureProvider(1, {
    enabled: false,
    mode: 'test',
    public_base_url: 'http://127.0.0.1:3000',
    prices: { plus: PRICE_PLUS, pro: PRICE_PRO }
  });
  assert.equal(context.payments.adminConfiguration().enabled, false);
  const portal = await context.payments.createPortal(userId);
  assert.match(portal.url, /^https:\/\/billing\.stripe\.com\//);
  await assert.rejects(
    context.payments.configureProvider(1, {
      enabled: false,
      mode: 'test',
      remove_secrets: true
    }),
    (error) => error.code === 'CREDENCIAIS_STRIPE_EM_USO'
  );
});

test('troca teste-produção é bloqueada enquanto houver vínculo financeiro ativo', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'mode');
  await activatePlan(context, userId, 'plus');
  await assert.rejects(
    context.payments.configureProvider(1, {
      enabled: true,
      mode: 'live',
      secret_key: 'rk_live_kairo_restricted_key',
      webhook_secret: WEBHOOK_SECRET,
      public_base_url: 'https://app.kairo.example',
      prices: { plus: PRICE_PLUS, pro: PRICE_PRO }
    }),
    (error) => error.code === 'MODO_STRIPE_EM_USO'
  );
});

test('configuração administrativa aceita RAK e nunca devolve segredo em texto claro', async (t) => {
  const context = createContext(t);
  await createRegularUser(context, 'config');
  const result = await context.payments.configureProvider(1, {
    enabled: true,
    mode: 'test',
    secret_key: 'rk_test_kairo_restricted_key',
    webhook_secret: WEBHOOK_SECRET,
    public_base_url: 'http://127.0.0.1:3000',
    prices: { plus: PRICE_PLUS, pro: PRICE_PRO }
  });
  assert.equal(result.has_secret_key, true);
  assert.equal('secret_key' in result, false);
  const persisted = context.db.get("SELECT * FROM payment_providers WHERE provider = 'stripe'");
  assert.doesNotMatch(persisted.encrypted_secret_key, /rk_test_/);
  assert.doesNotMatch(persisted.encrypted_webhook_secret, /whsec_/);
});

test('estorno integral da cobrança atual suspende o acesso', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'refund');
  const active = await activatePlan(context, userId, 'plus');
  const charge = {
    id: 'ch_refunded',
    amount: 1900,
    amount_refunded: 1900,
    refunded: true,
    currency: 'brl',
    invoice: active.invoice
  };
  context.stripe.state.charges.set(charge.id, charge);
  const result = await deliver(context, 'charge.refunded', charge, 'evt_refunded', BASE_TIME + 2);
  assert.equal(result.effect, 'acesso_suspenso_por_estorno_integral');
  assert.equal(planForUser(context.db, userId), 'free');
});

test('disputa suspende e vitória restaura acesso somente para a fatura atual paga', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'dispute');
  const active = await activatePlan(context, userId, 'plus');
  const charge = {
    id: 'ch_disputed',
    amount: 1900,
    amount_refunded: 0,
    refunded: false,
    currency: 'brl',
    invoice: active.invoice
  };
  context.stripe.state.charges.set(charge.id, charge);
  const opened = {
    id: 'dp_kairo',
    charge: charge.id,
    amount: 1900,
    currency: 'brl',
    status: 'needs_response'
  };
  await deliver(context, 'charge.dispute.created', opened, 'evt_dispute_open', BASE_TIME + 2);
  assert.equal(planForUser(context.db, userId), 'free');
  const won = { ...opened, status: 'won' };
  const result = await deliver(
    context,
    'charge.dispute.closed',
    won,
    'evt_dispute_won',
    BASE_TIME + 3
  );
  assert.equal(result.effect, 'acesso_restaurado_apos_disputa');
  assert.equal(planForUser(context.db, userId), 'plus');
});

test('exclusão de conta cancela a assinatura no Stripe antes de apagar vínculos', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'deletion');
  const active = await activatePlan(context, userId, 'pro');
  const result = await context.payments.cancelForAccountDeletion(userId);
  assert.equal(result.canceled, 1);
  assert.deepEqual(context.stripe.state.subscriptionCancelCalls, [active.subscription.id]);
  assert.equal(context.payments.getSubscription(userId).status, 'canceled');
  assert.equal(planForUser(context.db, userId), 'free');
});

test('validação administrativa cobre credenciais, URL, catálogo e Prices reais', async (t) => {
  const context = createContext(t);
  await createRegularUser(context, 'validation');

  await assert.rejects(
    context.payments.testConfiguration({ mode: 'live' }),
    (error) => error.code === 'CHAVE_STRIPE_INVALIDA'
  );
  await assert.rejects(
    context.payments.testConfiguration({ webhook_secret: 'invalido' }),
    (error) => error.code === 'SEGREDO_WEBHOOK_INVALIDO'
  );
  await assert.rejects(
    context.payments.testConfiguration({ public_base_url: 'http://kairo.example' }),
    (error) => error.code === 'URL_PUBLICA_INSEGURA'
  );
  await assert.rejects(
    context.payments.testConfiguration({ prices: { plus: PRICE_PLUS } }),
    (error) => error.code === 'PRECOS_STRIPE_INCOMPLETOS'
  );
  await assert.rejects(
    context.payments.testConfiguration({
      prices: { plus: 'valor-invalido', pro: PRICE_PRO }
    }),
    (error) => error.code === 'PRICE_ID_INVALIDO'
  );

  const originalRetrieve = context.stripe.client.prices.retrieve;
  context.stripe.client.prices.retrieve = async (id) =>
    id === PRICE_PRO ? price(id, 4_000) : originalRetrieve(id);
  await assert.rejects(
    context.payments.testConfiguration(),
    (error) => error.code === 'PRECO_STRIPE_DIVERGENTE'
  );
  context.stripe.client.prices.retrieve = originalRetrieve;

  const result = await context.payments.testConfiguration();
  assert.equal(result.account_id, 'acct_kairo_test');
  assert.deepEqual(
    result.prices.map((item) => item.plan_key),
    ['plus', 'pro']
  );
});

test('eventos de checkout atualizam o fluxo sem conceder plano antes da fatura', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'checkout-events');
  const checkout = await context.payments.createCheckout(userId, { plan_key: 'plus' });
  const fixture = createSubscriptionFixture(context, checkout, userId);
  fixture.session.subscription = fixture.subscription.id;

  const completed = await deliver(
    context,
    'checkout.session.completed',
    fixture.session,
    'evt_checkout_completed'
  );
  assert.equal(completed.effect, 'checkout_confirmado');
  assert.equal(planForUser(context.db, userId), 'free');

  const unsupported = await deliver(
    context,
    'product.updated',
    { id: 'prod_nao_utilizado' },
    'evt_unsupported'
  );
  assert.equal(unsupported.effect, 'evento_nao_utilizado');

  const expiredCheckout = await context.payments.createCheckout(userId, { plan_key: 'pro' });
  const expiredSession = context.stripe.state.sessions.get(expiredCheckout.checkout_session_id);
  const expired = await deliver(
    context,
    'checkout.session.expired',
    expiredSession,
    'evt_checkout_expired'
  );
  assert.equal(expired.effect, 'checkout_expirado');

  const failedCheckout = await context.payments.createCheckout(userId, { plan_key: 'pro' });
  const failedSession = context.stripe.state.sessions.get(failedCheckout.checkout_session_id);
  const failed = await deliver(
    context,
    'checkout.session.async_payment_failed',
    failedSession,
    'evt_checkout_failed'
  );
  assert.equal(failed.effect, 'pagamento_assincrono_falhou');
});

test('fatura atual inválida revoga acesso e registra falha sem aceitar moeda divergente', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'invoice-errors');
  const active = await activatePlan(context, userId, 'plus');

  const voided = { ...active.invoice, paid: false, status: 'void' };
  const voidResult = await deliver(
    context,
    'invoice.voided',
    voided,
    'evt_invoice_voided',
    BASE_TIME + 2
  );
  assert.equal(voidResult.effect, 'acesso_revogado');
  assert.equal(planForUser(context.db, userId), 'free');

  active.subscription.status = 'active';
  active.subscription.latest_invoice = 'in_wrong_currency';
  const wrongCurrency = {
    ...active.invoice,
    id: 'in_wrong_currency',
    currency: 'usd',
    paid: true,
    status: 'paid'
  };
  context.stripe.state.invoices.set(wrongCurrency.id, wrongCurrency);
  await assert.rejects(
    deliver(context, 'invoice.paid', wrongCurrency, 'evt_wrong_currency', BASE_TIME + 3),
    (error) => error.code === 'MOEDA_FATURA_DIVERGENTE'
  );
  assert.equal(
    context.db.get(
      "SELECT processing_status FROM webhook_events WHERE event_id = 'evt_wrong_currency'"
    ).processing_status,
    'failed'
  );
});

test('estornos parciais, falhos e históricos preservam a concessão correta', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'refund-branches');
  const active = await activatePlan(context, userId, 'plus');
  const charge = {
    id: 'ch_partial',
    amount: 1_900,
    amount_refunded: 500,
    refunded: false,
    currency: 'brl',
    invoice: active.invoice
  };
  context.stripe.state.charges.set(charge.id, charge);

  const partial = await deliver(
    context,
    'refund.updated',
    { id: 're_partial', charge: charge.id, amount: 500, currency: 'brl', status: 'succeeded' },
    'evt_refund_partial',
    BASE_TIME + 2
  );
  assert.equal(partial.effect, 'estorno_parcial_registrado');
  assert.equal(planForUser(context.db, userId), 'plus');

  const failed = await deliver(
    context,
    'refund.failed',
    { id: 're_failed', charge: charge.id, amount: 500, currency: 'brl', status: 'failed' },
    'evt_refund_failed',
    BASE_TIME + 3
  );
  assert.equal(failed.effect, 'estorno_falhou');

  const historicalInvoice = { ...active.invoice, id: 'in_historical_refund' };
  const historicalCharge = { ...charge, id: 'ch_historical', invoice: historicalInvoice };
  context.stripe.state.charges.set(historicalCharge.id, historicalCharge);
  const historical = await deliver(
    context,
    'refund.created',
    {
      id: 're_historical',
      charge: historicalCharge.id,
      amount: 500,
      currency: 'brl',
      status: 'succeeded'
    },
    'evt_refund_historical',
    BASE_TIME + 4
  );
  assert.equal(historical.effect, 'evento_financeiro_historico');
});

test('disputa perdida mantém suspensão e reconciliação corrige assinatura removida', async (t) => {
  const context = createContext(t);
  const userId = await createRegularUser(context, 'reconcile-missing');
  const active = await activatePlan(context, userId, 'pro');
  const charge = {
    id: 'ch_lost',
    amount: 3_900,
    amount_refunded: 0,
    refunded: false,
    currency: 'brl',
    invoice: active.invoice
  };
  context.stripe.state.charges.set(charge.id, charge);
  const lost = await deliver(
    context,
    'charge.dispute.closed',
    { id: 'dp_lost', charge: charge.id, amount: 3_900, currency: 'brl', status: 'lost' },
    'evt_dispute_lost',
    BASE_TIME + 2
  );
  assert.equal(lost.effect, 'acesso_suspenso_por_disputa_perdida');
  assert.equal(planForUser(context.db, userId), 'free');

  context.stripe.state.subscriptions.delete(active.subscription.id);
  const reconciliation = await context.payments.reconcileUser(userId);
  assert.equal(reconciliation.reconciled[0].status, 'canceled');
  assert.equal(context.payments.metrics().subscriptions[0].status, 'canceled');
  const all = await context.payments.reconcileAll();
  assert.equal(all.users, 1);
});

test('webhook recusa corpo processado, ambiente divergente e concorrência ativa', async (t) => {
  const context = createContext(t);
  await assert.rejects(
    context.payments.handleStripeWebhook('{}', 'stripe-signature-valid'),
    (error) => error.code === 'CORPO_WEBHOOK_INVALIDO'
  );
  const liveEvent = Buffer.from(
    JSON.stringify({
      id: 'evt_live_in_test',
      type: 'product.updated',
      livemode: true,
      created: BASE_TIME,
      data: { object: { id: 'prod_live' } }
    })
  );
  await assert.rejects(
    context.payments.handleStripeWebhook(liveEvent, 'stripe-signature-valid'),
    (error) => error.code === 'MODO_STRIPE_DIVERGENTE'
  );

  context.db.run(
    `INSERT INTO webhook_events
       (provider, mode, event_id, event_type, processing_status, payload_sha256, updated_at)
     VALUES ('stripe', 'test', 'evt_processing', 'product.updated', 'processing', 'hash', ?)`,
    [new Date(BASE_TIME * 1000).toISOString().slice(0, 19).replace('T', ' ')]
  );
  await assert.rejects(
    deliver(context, 'product.updated', { id: 'prod_processing' }, 'evt_processing'),
    (error) => error.code === 'EVENTO_STRIPE_EM_PROCESSAMENTO'
  );
});

test('indisponibilidade e ausência de vínculo retornam estados seguros e explícitos', async (t) => {
  const disabled = createContext(t, {
    environment: environment({
      enabled: false,
      secretKey: null,
      webhookSecret: null,
      publicBaseUrl: null,
      prices: {}
    })
  });
  const disabledPlans = disabled.payments.listPlans();
  assert.equal(disabledPlans.provider.available, false);
  assert.equal(disabledPlans.plans.find((plan) => plan.key === 'plus').checkout_available, false);

  const context = createContext(t);
  const userId = await createRegularUser(context, 'without-billing');
  assert.equal(context.payments.getSubscription(userId), null);
  assert.deepEqual(context.payments.listInvoices(userId), []);
  assert.deepEqual(await context.payments.cancelForAccountDeletion(userId), { canceled: 0 });
  await assert.rejects(
    context.payments.createPortal(userId),
    (error) => error.code === 'CLIENTE_STRIPE_INEXISTENTE'
  );
  await assert.rejects(
    context.payments.cancel(userId),
    (error) => error.code === 'SEM_ASSINATURA_ATIVA'
  );
  await assert.rejects(
    context.payments.testConfiguration({ public_base_url: 'nao-e-url' }),
    (error) => error.code === 'URL_PUBLICA_INVALIDA'
  );
});
