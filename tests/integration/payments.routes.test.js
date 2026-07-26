// ============================================================================
// Kairo — Contratos HTTP da Tarefa 13 (Stripe, CSRF, admin e corpo bruto)
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import {
  createPaymentsRouter,
  createPaymentsWebhookRouter
} from '../../src/server/modules/payments/payments.routes.js';
import { errorHandler } from '../../src/server/middleware/error-handler.js';
import { forbidden, unauthorized } from '../../src/server/shared/http-error.js';

function createHttpContext() {
  const calls = [];
  const paymentsService = {
    listPlans: () => ({ provider: { available: true }, plans: [] }),
    createCheckout: async (userId, body) => ({
      provider: 'stripe',
      checkout_id: 'checkout-local',
      checkout_session_id: 'cs_test_checkout',
      url: 'https://checkout.stripe.com/c/pay/cs_test_checkout',
      userId,
      body
    }),
    getSubscription: () => null,
    listInvoices: () => [],
    createPortal: async () => ({ url: 'https://billing.stripe.com/p/session/teste' }),
    cancel: async () => ({ plan_key: 'plus', current_period_end: '2026-08-26' }),
    reconcileUser: async (userId, body) => {
      calls.push({ method: 'reconcileUser', userId, body });
      return { user_id: userId, checkout: { confirmed: true } };
    },
    adminConfiguration: () => ({ provider: 'stripe', configured: true }),
    testConfiguration: async () => ({ mode: 'test' }),
    configureProvider: async () => ({ enabled: true, mode: 'test' }),
    metrics: () => ({ subscriptions: [], revenue: {}, webhooks: {} }),
    reconcileAll: async () => ({ users: 0, results: [] }),
    handleStripeWebhook: async (rawBody, signature) => {
      calls.push({ method: 'handleStripeWebhook', isBuffer: Buffer.isBuffer(rawBody), signature });
      return { processed: true, event_id: 'evt_raw' };
    }
  };
  const authService = { audit: (entry) => calls.push({ method: 'audit', entry }) };
  const requireAuth = (req, _res, next) => {
    if (req.get('x-test-auth') === 'none') return next(unauthorized());
    req.user = {
      id: 42,
      role: req.get('x-test-role') === 'admin' ? 'administrador' : 'usuario'
    };
    next();
  };
  const requireAdmin = (req, _res, next) =>
    req.user?.role === 'administrador' ? next() : next(forbidden());
  const requireCsrf = (req, _res, next) =>
    req.get('x-csrf-token') === 'csrf-ok'
      ? next()
      : next(forbidden('Token CSRF inválido.', 'CSRF_INVALIDO'));
  const mutationLimiter = (_req, _res, next) => next();

  const app = express();
  app.use('/api/payments/webhooks', createPaymentsWebhookRouter({ paymentsService }));
  app.use(express.json());
  app.use(
    '/api/payments',
    createPaymentsRouter({
      paymentsService,
      authService,
      requireAuth,
      requireAdmin,
      requireCsrf,
      mutationLimiter
    })
  );
  app.use(errorHandler({ logger: { error() {} } }));
  return { app, calls };
}

test('webhook preserva corpo bruto e encaminha Stripe-Signature', async () => {
  const context = createHttpContext();
  const response = await request(context.app)
    .post('/api/payments/webhooks/stripe')
    .set('content-type', 'application/json')
    .set('stripe-signature', 't=1,v1=assinatura')
    .send('{"id":"evt_raw"}')
    .expect(200);
  assert.equal(response.body.processed, true);
  assert.deepEqual(
    context.calls.find((call) => call.method === 'handleStripeWebhook'),
    {
      method: 'handleStripeWebhook',
      isBuffer: true,
      signature: 't=1,v1=assinatura'
    }
  );
});

test('checkout exige sessão e CSRF antes de chamar o serviço', async () => {
  const context = createHttpContext();
  await request(context.app)
    .post('/api/payments/checkout')
    .set('x-test-auth', 'none')
    .send({ plan_key: 'plus' })
    .expect(401);
  await request(context.app).post('/api/payments/checkout').send({ plan_key: 'plus' }).expect(403);
  const response = await request(context.app)
    .post('/api/payments/checkout')
    .set('x-csrf-token', 'csrf-ok')
    .send({ plan_key: 'plus' })
    .expect(201);
  assert.equal(response.body.checkout_session_id, 'cs_test_checkout');
});

test('reconciliação aceita somente Session ID Stripe e preserva o vínculo do usuário', async () => {
  const context = createHttpContext();
  await request(context.app)
    .post('/api/payments/reconcile')
    .set('x-csrf-token', 'csrf-ok')
    .send({ checkout_session_id: 'sessao-invalida' })
    .expect(422);
  await request(context.app)
    .post('/api/payments/reconcile')
    .set('x-csrf-token', 'csrf-ok')
    .send({ checkout_session_id: 'cs_test_retorno123' })
    .expect(200);
  assert.deepEqual(
    context.calls.find((call) => call.method === 'reconcileUser'),
    {
      method: 'reconcileUser',
      userId: 42,
      body: { checkout_session_id: 'cs_test_retorno123' }
    }
  );
});

test('configuração e métricas financeiras são exclusivas do administrador', async () => {
  const context = createHttpContext();
  await request(context.app).get('/api/payments/admin/provider').expect(403);
  await request(context.app)
    .get('/api/payments/admin/provider')
    .set('x-test-role', 'admin')
    .expect(200);
  await request(context.app)
    .put('/api/payments/admin/provider')
    .set('x-test-role', 'admin')
    .send({ enabled: true, mode: 'test' })
    .expect(403);
  const response = await request(context.app)
    .put('/api/payments/admin/provider')
    .set('x-test-role', 'admin')
    .set('x-csrf-token', 'csrf-ok')
    .send({ enabled: true, mode: 'test' })
    .expect(200);
  assert.equal(response.body.enabled, true);
});
