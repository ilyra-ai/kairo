// ============================================================================
// Kairo — Contratos HTTP da Suíte Inteligente Administrável (Tarefa 35)
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../src/server/middleware/error-handler.js';
import { createSmartFeaturesRouter } from '../../src/server/modules/smart/smart-features.routes.js';
import { createSmartUserRouter } from '../../src/server/modules/smart/smart-user.routes.js';
import { forbidden, unauthorized } from '../../src/server/shared/http-error.js';

function middleware() {
  const requireAuth = (req, _res, next) => {
    if (req.get('x-test-auth') === 'none') return next(unauthorized());
    req.user = {
      id: 42,
      role: req.get('x-test-role') === 'admin' ? 'administrador' : 'usuario',
      plan: 'pro'
    };
    next();
  };
  const requireAdmin = (req, _res, next) =>
    req.user?.role === 'administrador' ? next() : next(forbidden());
  const requireCsrf = (req, _res, next) =>
    req.get('x-csrf-token') === 'csrf-ok'
      ? next()
      : next(forbidden('Token CSRF inválido.', 'CSRF_INVALIDO'));
  return {
    requireAuth,
    requireAdmin,
    requireCsrf,
    mutationLimiter: (_req, _res, next) => next()
  };
}

test('governança HTTP exige admin e CSRF e executa CRUD, teste e privacidade', async () => {
  const calls = [];
  const smartFeaturesService = {
    list: () => [{ key: 'energy_budget', enabled: false }],
    listTemplates: () => [{ key: 'brain_dump', available: true }],
    get: (key) => ({ key, enabled: false }),
    create: (input) => {
      calls.push(['create', input]);
      return { key: input.key, name: 'Brain Dump', enabled: false };
    },
    updateConfig: (key, input) => {
      calls.push(['update', key, input]);
      return { key, enabled: input.enabled ?? false };
    },
    test: async (key) => ({ feature: key, ready: true, checks: [] }),
    listAudit: () => [{ action: 'config.update' }],
    remove: (key) => ({ deleted: true, key })
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/admin/smart-features',
    createSmartFeaturesRouter({
      smartFeaturesService,
      emotionalMapService: {
        anonymousSummary: () => ({ privacy_threshold_met: false, users: null })
      },
      authService: { audit: (entry) => calls.push(['audit', entry.action]) },
      ...middleware()
    })
  );
  app.use(errorHandler({ logger: { error() {} } }));

  await request(app).get('/api/admin/smart-features').set('x-test-auth', 'none').expect(401);
  await request(app).get('/api/admin/smart-features').expect(403);
  const catalog = await request(app)
    .get('/api/admin/smart-features')
    .set('x-test-role', 'admin')
    .expect(200);
  assert.equal(catalog.body.templates[0].available, true);

  await request(app)
    .post('/api/admin/smart-features')
    .set('x-test-role', 'admin')
    .send({ key: 'brain_dump' })
    .expect(403);
  await request(app)
    .post('/api/admin/smart-features')
    .set('x-test-role', 'admin')
    .set('x-csrf-token', 'csrf-ok')
    .send({ key: 'brain_dump' })
    .expect(201);
  await request(app)
    .put('/api/admin/smart-features/brain_dump')
    .set('x-test-role', 'admin')
    .set('x-csrf-token', 'csrf-ok')
    .send({ enabled: true })
    .expect(200);
  await request(app)
    .post('/api/admin/smart-features/brain_dump/test')
    .set('x-test-role', 'admin')
    .set('x-csrf-token', 'csrf-ok')
    .expect(200);
  await request(app)
    .get('/api/admin/smart-features/privacy/emotional-summary')
    .set('x-test-role', 'admin')
    .expect(200);
  await request(app)
    .delete('/api/admin/smart-features/brain_dump')
    .set('x-test-role', 'admin')
    .set('x-csrf-token', 'csrf-ok')
    .expect(200);
  assert.ok(calls.some((call) => call[0] === 'create'));
  assert.ok(calls.some((call) => call[0] === 'update'));
});

test('rotas do usuário ocultam vínculos administrativos e executam IA, exclusão e CRUD de lembretes', async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use(
    '/api/smart',
    createSmartUserRouter({
      smartFeaturesService: {
        list: () => [
          {
            key: 'predictive_coach',
            name: 'Coach',
            description: 'Descrição',
            category: 'coaching',
            requires_ai: false,
            enabled: true,
            ai_connection_id: 9,
            ai_artifact_id: 77
          }
        ],
        generateAssistance: async (key, user, body) => {
          calls.push(['ai', key, user.userId, body.purpose]);
          return { text: 'Orientação real', model: 'qwen3-0.6b', is_local: true };
        }
      },
      passiveTrackingService: { purge: (userId) => ({ deleted: userId }) },
      emotionalMapService: { purge: (userId) => ({ deleted: userId }) },
      escalatedRemindersService: {
        list: () => [{ id: 5, title: 'Lembrete' }],
        schedule: () => ({ id: 5 }),
        due: () => [],
        escalate: () => ({ id: 5, level: 1 }),
        act: () => ({ id: 5, status: 'concluido' }),
        reschedule: (_userId, id, body) => ({ id, title: body.title, next_at: body.base_at }),
        remove: (_userId, id) => ({ deleted: true, id })
      },
      ...middleware()
    })
  );
  app.use(errorHandler({ logger: { error() {} } }));

  await request(app).get('/api/smart/features').set('x-test-auth', 'none').expect(401);
  const catalog = await request(app).get('/api/smart/features').expect(200);
  assert.equal(catalog.body.features[0].ai_available, true);
  assert.equal(Object.hasOwn(catalog.body.features[0], 'ai_connection_id'), false);
  assert.equal(Object.hasOwn(catalog.body.features[0], 'ai_artifact_id'), false);

  const assistance = await request(app)
    .post('/api/smart/features/predictive_coach/ai-assistance')
    .set('x-csrf-token', 'csrf-ok')
    .send({ purpose: 'coaching', context: { risk: 'sobrecarga' } })
    .expect(200);
  assert.equal(assistance.body.text, 'Orientação real');
  assert.deepEqual(calls[0], ['ai', 'predictive_coach', 42, 'coaching']);

  await request(app).delete('/api/smart/passive').set('x-csrf-token', 'csrf-ok').expect(200);
  await request(app).delete('/api/smart/emotional').set('x-csrf-token', 'csrf-ok').expect(200);
  await request(app).get('/api/smart/reminders').expect(200);
  await request(app)
    .put('/api/smart/reminders/5')
    .set('x-csrf-token', 'csrf-ok')
    .send({ title: 'Novo título', base_at: '2026-07-27 09:00' })
    .expect(200);
  await request(app).delete('/api/smart/reminders/5').set('x-csrf-token', 'csrf-ok').expect(200);
});
