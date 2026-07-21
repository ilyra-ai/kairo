// ============================================================================
// Kairo — Integração do termômetro de energia e cronotipo (Tarefa 23)
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { test } from 'node:test';
import {
  ensureCoreSchema,
  ensureUserWorkspace,
  openSqliteClient
} from '../../src/server/database/index.js';
import { createAuthenticationMiddleware } from '../../src/server/middleware/authentication.js';
import {
  apiNotFound,
  errorHandler,
  requestIdMiddleware
} from '../../src/server/middleware/error-handler.js';
import { createAuthRouter } from '../../src/server/modules/auth/auth.routes.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { createEnergyRouter } from '../../src/server/modules/energy/energy.routes.js';
import {
  AMOSTRA_MINIMA,
  createEnergyService
} from '../../src/server/modules/energy/energy.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';

const COOKIE_NAME = 'kairo.session';
const SESSION_SECRET = 'segredo-energia-com-mais-de-trinta-e-dois-bytes-para-2026';
const NO_LIMIT = (_req, _res, next) => next();

function createContext(t, { horaFixa = null } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-energia-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);

  const authService = createAuthService({
    db,
    sessionSecret: SESSION_SECRET,
    sessionTtlMs: 60 * 60 * 1000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const energyService = createEnergyService({
    db,
    now: () => (horaFixa ? new Date(horaFixa) : new Date())
  });
  const authentication = createAuthenticationMiddleware({ authService, cookieName: COOKIE_NAME });

  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    '/api/auth',
    createAuthRouter({
      authService,
      ...authentication,
      cookieName: COOKIE_NAME,
      cookieOptions: { sameSite: 'strict', secure: false },
      loginLimiter: NO_LIMIT,
      registerLimiter: NO_LIMIT
    })
  );
  app.use(
    '/api/energy',
    createEnergyRouter({ energyService, authService, ...authentication, mutationLimiter: NO_LIMIT })
  );
  app.use('/api', apiNotFound);
  app.use(errorHandler({ logger: { error: () => {} }, isDevelopment: false }));

  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return { app, db, energyService };
}

async function registrar(context, email) {
  const agent = request.agent(context.app);
  const response = await agent
    .post('/api/auth/register')
    .send({ name: 'Titular', email, password: 'senha-energia' })
    .expect(201);
  return { agent, csrfToken: response.body.csrfToken };
}

test('registro com um toque persiste e valida a escala', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await registrar(context, 'toque@energia.local');

  await agent
    .post('/api/energy')
    .set('x-csrf-token', csrfToken)
    .send({ level: 4, context: 'manha' })
    .expect(201)
    .expect(({ body }) => {
      assert.equal(body.level, 4);
      assert.equal(body.context, 'manha');
      assert.match(body.logged_date, /^\d{4}-\d{2}-\d{2}$/);
    });

  // Nível fora da escala é rejeitado.
  await agent.post('/api/energy').set('x-csrf-token', csrfToken).send({ level: 9 }).expect(422);
});

test('insights só revelam padrões com amostra mínima e explicam quando faltam dados', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await registrar(context, 'insights@energia.local');

  // Poucas amostras → não pronto, com mensagem explicativa.
  await agent.post('/api/energy').set('x-csrf-token', csrfToken).send({ level: 3 }).expect(201);
  await agent
    .get('/api/energy')
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.insights.ready, false);
      assert.equal(body.insights.samples, 1);
      assert.match(body.insights.message, new RegExp(String(AMOSTRA_MINIMA)));
    });

  // Completa a amostra mínima.
  for (let i = 0; i < AMOSTRA_MINIMA; i += 1) {
    await agent
      .post('/api/energy')
      .set('x-csrf-token', csrfToken)
      .send({ level: (i % 5) + 1 })
      .expect(201);
  }

  await agent
    .get('/api/energy')
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.insights.ready, true);
      assert.ok(body.insights.peaks.length > 0);
      assert.ok(body.insights.confidence > 0);
      assert.ok(body.insights.disclaimer.includes('não constituem diagnóstico'));
      assert.equal(body.heatmap.length, 24);
    });
});

test('desativar bloqueia registro; excluir remove registros e isola por usuário', async (t) => {
  const context = createContext(t);
  const dono = await registrar(context, 'dono@energia.local');
  const outro = await registrar(context, 'outro@energia.local');

  await dono.agent
    .post('/api/energy')
    .set('x-csrf-token', dono.csrfToken)
    .send({ level: 5 })
    .expect(201);
  await outro.agent
    .post('/api/energy')
    .set('x-csrf-token', outro.csrfToken)
    .send({ level: 2 })
    .expect(201);

  // Desativar bloqueia novos registros.
  await dono.agent
    .put('/api/energy/settings')
    .set('x-csrf-token', dono.csrfToken)
    .send({ enabled: false })
    .expect(200);
  await dono.agent
    .post('/api/energy')
    .set('x-csrf-token', dono.csrfToken)
    .send({ level: 3 })
    .expect(422)
    .expect(({ body }) => assert.equal(body.error.code, 'ENERGIA_DESATIVADA'));

  // Reativa e exclui tudo do dono; o outro usuário permanece intacto.
  await dono.agent
    .put('/api/energy/settings')
    .set('x-csrf-token', dono.csrfToken)
    .send({ enabled: true })
    .expect(200);
  await dono.agent
    .delete('/api/energy')
    .set('x-csrf-token', dono.csrfToken)
    .expect(200)
    .expect(({ body }) => assert.equal(body.deleted, 1));

  assert.equal(
    Number(context.db.get('SELECT COUNT(*) AS total FROM energy_logs WHERE user_id = 1').total),
    0
  );
  assert.equal(
    Number(context.db.get('SELECT COUNT(*) AS total FROM energy_logs WHERE user_id = 2').total),
    1,
    'os registros de outro usuário não podem ser afetados'
  );
});
