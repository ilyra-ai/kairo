// ============================================================================
// Kairo — Integração do analytics temporal da agenda (Tarefa 20)
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
import { createActivitiesRouter } from '../../src/server/modules/activities/activities.routes.js';
import { createActivitiesService } from '../../src/server/modules/activities/activities.service.js';
import { createAgendaRouter } from '../../src/server/modules/agenda/agenda.routes.js';
import { createAgendaService } from '../../src/server/modules/agenda/agenda.service.js';
import { createAnalyticsRouter } from '../../src/server/modules/analytics/analytics.routes.js';
import { createAnalyticsService } from '../../src/server/modules/analytics/analytics.service.js';
import { createAuthRouter } from '../../src/server/modules/auth/auth.routes.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';

const COOKIE_NAME = 'kairo.session';
const SESSION_SECRET = 'segredo-analytics-com-mais-de-trinta-e-dois-bytes-2026';
const NO_LIMIT = (_req, _res, next) => next();

function createContext(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-analytics-'));
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
  const activitiesService = createActivitiesService(db);
  const agendaService = createAgendaService({ db, timeZone: 'America/Sao_Paulo' });
  const analyticsService = createAnalyticsService(db);
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
    '/api/activities',
    createActivitiesRouter({
      activitiesService,
      authService,
      ...authentication,
      mutationLimiter: NO_LIMIT
    })
  );
  app.use(
    '/api',
    createAgendaRouter({ agendaService, ...authentication, mutationLimiter: NO_LIMIT })
  );
  app.use('/api/analytics', createAnalyticsRouter({ analyticsService, ...authentication }));
  app.use('/api', apiNotFound);
  app.use(errorHandler({ logger: { error: () => {} }, isDevelopment: false }));

  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return { app, db };
}

async function registrar(context, email) {
  const agent = request.agent(context.app);
  const response = await agent
    .post('/api/auth/register')
    .send({ name: 'Titular', email, password: 'senha-analytics' })
    .expect(201);
  return { agent, csrfToken: response.body.csrfToken };
}

async function criarCompromisso(agente, csrf, activityId, data, inicio, fim) {
  const resposta = await agente
    .post('/api/agenda')
    .set('x-csrf-token', csrf)
    .send({
      title: `Compromisso ${data} ${inicio}`,
      event_date: data,
      start_time: inicio,
      end_time: fim,
      activity_id: activityId
    })
    .expect(201);
  return resposta.body.id ?? resposta.body.event?.id;
}

test('timeseries agrega horas reais por dia e respeita o isolamento por usuário', async (t) => {
  const context = createContext(t);
  const dono = await registrar(context, 'dono@analytics.local');
  const outro = await registrar(context, 'outro@analytics.local');

  const atividade = await dono.agent
    .post('/api/activities')
    .set('x-csrf-token', dono.csrfToken)
    .send({ title: 'Estudo Analytics' })
    .expect(201);

  await criarCompromisso(
    dono.agent,
    dono.csrfToken,
    atividade.body.id,
    '2026-07-10',
    '08:00',
    '10:00'
  );
  await criarCompromisso(
    dono.agent,
    dono.csrfToken,
    atividade.body.id,
    '2026-07-10',
    '14:00',
    '15:30'
  );
  await criarCompromisso(
    dono.agent,
    dono.csrfToken,
    atividade.body.id,
    '2026-08-05',
    '09:00',
    '10:00'
  );

  // Ruído de outro usuário — não pode aparecer no total do dono.
  const atividadeOutro = await outro.agent
    .post('/api/activities')
    .set('x-csrf-token', outro.csrfToken)
    .send({ title: 'Ruído' })
    .expect(201);
  await criarCompromisso(
    outro.agent,
    outro.csrfToken,
    atividadeOutro.body.id,
    '2026-07-10',
    '11:00',
    '20:00'
  );

  await dono.agent
    .get('/api/analytics/timeseries')
    .expect(200)
    .expect(({ body }) => {
      const julho10 = body.points.find((ponto) => ponto.date === '2026-07-10');
      assert.equal(julho10.total_hours, 3.5, 'soma exatamente as horas do dono no dia');
      assert.equal(julho10.events, 2);
      assert.equal(body.totals.hours, 4.5);
      assert.deepEqual(body.available.years, [2026]);
      assert.deepEqual(body.available.months, [7, 8]);
    });
});

test('filtros de múltipla seleção retornam somente os períodos escolhidos', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await registrar(context, 'filtros@analytics.local');
  const atividade = await agent
    .post('/api/activities')
    .set('x-csrf-token', csrfToken)
    .send({ title: 'Foco' })
    .expect(201);

  await criarCompromisso(agent, csrfToken, atividade.body.id, '2026-07-10', '08:00', '09:00');
  await criarCompromisso(agent, csrfToken, atividade.body.id, '2026-08-05', '08:00', '09:00');

  // Somente agosto.
  await agent
    .get('/api/analytics/timeseries?months=8')
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.points.length, 1);
      assert.equal(body.points[0].date, '2026-08-05');
    });

  // Mês inexistente na base retorna série vazia.
  await agent
    .get('/api/analytics/timeseries?months=12')
    .expect(200)
    .expect(({ body }) => assert.equal(body.points.length, 0));

  // Mês inválido é rejeitado pelo contrato.
  await agent.get('/api/analytics/timeseries?months=99').expect(422);
});

test('drill-down retorna os compromissos reais do dia e valida a data', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await registrar(context, 'drill@analytics.local');
  const atividade = await agent
    .post('/api/activities')
    .set('x-csrf-token', csrfToken)
    .send({ title: 'Detalhe' })
    .expect(201);

  await criarCompromisso(agent, csrfToken, atividade.body.id, '2026-07-10', '08:00', '09:00');
  await criarCompromisso(agent, csrfToken, atividade.body.id, '2026-07-10', '10:00', '11:30');

  await agent
    .get('/api/analytics/drilldown?date=2026-07-10')
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.date, '2026-07-10');
      assert.equal(body.events.length, 2);
      assert.equal(body.events[0].start_time, '08:00');
      assert.equal(body.events[0].activity_title, 'Detalhe');
    });

  await agent.get('/api/analytics/drilldown?date=10-07-2026').expect(422);
  await request(context.app).get('/api/analytics/timeseries').expect(401);
});
