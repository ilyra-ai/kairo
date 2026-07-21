// ============================================================================
// Kairo — Integração do construtor de gráficos personalizados (Tarefa 21)
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
import { createAnalyticsService } from '../../src/server/modules/analytics/analytics.service.js';
import { createAuthRouter } from '../../src/server/modules/auth/auth.routes.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { createChartsRouter } from '../../src/server/modules/charts/charts.routes.js';
import { createChartsService } from '../../src/server/modules/charts/charts.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';

const COOKIE_NAME = 'kairo.session';
const SESSION_SECRET = 'segredo-charts-com-mais-de-trinta-e-dois-bytes-para-2026';
const NO_LIMIT = (_req, _res, next) => next();

function createContext(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-charts-'));
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
  const chartsService = createChartsService({ db, analyticsService });
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
  app.use(
    '/api/charts',
    createChartsRouter({ chartsService, authService, ...authentication, mutationLimiter: NO_LIMIT })
  );
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
    .send({ name: 'Titular', email, password: 'senha-charts' })
    .expect(201);
  return { agent, csrfToken: response.body.csrfToken };
}

async function semear(agent, csrf) {
  const atividade = await agent
    .post('/api/activities')
    .set('x-csrf-token', csrf)
    .send({ title: 'Trabalho Focado' })
    .expect(201);
  const base = { activity_id: atividade.body.id };
  await agent
    .post('/api/agenda')
    .set('x-csrf-token', csrf)
    .send({ ...base, title: 'A', event_date: '2026-07-10', start_time: '08:00', end_time: '10:00' })
    .expect(201);
  await agent
    .post('/api/agenda')
    .set('x-csrf-token', csrf)
    .send({ ...base, title: 'B', event_date: '2026-07-11', start_time: '09:00', end_time: '10:00' })
    .expect(201);
  return atividade.body.id;
}

const DEF_VALIDA = {
  title: 'Horas por categoria',
  source: 'agenda',
  dimension: 'activity',
  metric: 'hours',
  aggregate: 'sum',
  chart_type: 'bars'
};

test('catálogo expõe fontes, dimensões e métricas sem SQL cru', async (t) => {
  const context = createContext(t);
  const { agent } = await registrar(context, 'catalogo@charts.local');

  await agent
    .get('/api/charts/catalog')
    .expect(200)
    .expect(({ body }) => {
      assert.ok(body.sources.agenda);
      assert.ok(body.sources.agenda.dimensions.activity);
      assert.ok(body.sources.agenda.metrics.hours.aggregates.includes('sum'));
      assert.ok(Array.isArray(body.chart_types));
      // Nenhuma expressão SQL deve vazar no catálogo.
      assert.equal(JSON.stringify(body).includes('agenda_events.'), false);
    });
});

test('prévia calcula dados reais e rejeita combinações incompatíveis', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await registrar(context, 'previa@charts.local');
  await semear(agent, csrfToken);

  // O preview não recebe título (só a definição visual da consulta).
  const { title: _titulo, ...defPreview } = DEF_VALIDA;

  await agent
    .post('/api/charts/preview')
    .set('x-csrf-token', csrfToken)
    .send(defPreview)
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.data.length, 1);
      assert.equal(body.data[0].label, 'Trabalho Focado');
      assert.equal(body.data[0].value, 3);
    });

  // Métrica de contagem não aceita "avg": combinação incompatível.
  await agent
    .post('/api/charts/preview')
    .set('x-csrf-token', csrfToken)
    .send({ ...defPreview, metric: 'events', aggregate: 'avg' })
    .expect(422)
    .expect(({ body }) => assert.equal(body.error.code, 'AGREGACAO_INCOMPATIVEL'));

  // Dimensão inexistente é rejeitada.
  await agent
    .post('/api/charts/preview')
    .set('x-csrf-token', csrfToken)
    .send({ ...defPreview, dimension: 'inexistente' })
    .expect(422)
    .expect(({ body }) => assert.equal(body.error.code, 'DIMENSAO_INVALIDA'));
});

test('CRUD persiste por usuário, duplica, reordena e isola entre contas', async (t) => {
  const context = createContext(t);
  const dono = await registrar(context, 'dono@charts.local');
  const outro = await registrar(context, 'outro@charts.local');
  await semear(dono.agent, dono.csrfToken);

  const criado = await dono.agent
    .post('/api/charts')
    .set('x-csrf-token', dono.csrfToken)
    .send(DEF_VALIDA)
    .expect(201);
  assert.equal(criado.body.position, 0);

  const segundo = await dono.agent
    .post('/api/charts')
    .set('x-csrf-token', dono.csrfToken)
    .send({
      ...DEF_VALIDA,
      title: 'Compromissos por dia',
      dimension: 'day',
      metric: 'events',
      aggregate: 'count'
    })
    .expect(201);
  assert.equal(segundo.body.position, 1);

  // Renderização com dados reais.
  await dono.agent
    .get(`/api/charts/${criado.body.id}/data`)
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.chart.id, criado.body.id);
      assert.equal(body.data[0].value, 3);
    });

  // Duplicar.
  const copia = await dono.agent
    .post(`/api/charts/${criado.body.id}/duplicate`)
    .set('x-csrf-token', dono.csrfToken)
    .expect(201);
  assert.match(copia.body.title, /cópia/);

  // Reordenar: inverter a ordem.
  const ordemInvertida = [segundo.body.id, copia.body.id, criado.body.id];
  await dono.agent
    .put('/api/charts/reorder')
    .set('x-csrf-token', dono.csrfToken)
    .send({ order: ordemInvertida })
    .expect(200)
    .expect(({ body }) => {
      assert.deepEqual(
        body.map((chart) => chart.id),
        ordemInvertida
      );
    });

  // Atualizar.
  await dono.agent
    .put(`/api/charts/${criado.body.id}`)
    .set('x-csrf-token', dono.csrfToken)
    .send({ chart_type: 'donut' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.chart_type, 'donut'));

  // Isolamento: outro usuário não vê nem acessa.
  await outro.agent
    .get('/api/charts')
    .expect(200)
    .expect(({ body }) => assert.equal(body.length, 0));
  await outro.agent.get(`/api/charts/${criado.body.id}/data`).expect(404);

  // Excluir remove só a configuração; os compromissos-fonte permanecem.
  await dono.agent
    .delete(`/api/charts/${criado.body.id}`)
    .set('x-csrf-token', dono.csrfToken)
    .expect(204);
  await dono.agent
    .get('/api/charts')
    .expect(200)
    .expect(({ body }) => assert.equal(body.length, 2));
  assert.equal(
    Number(context.db.get('SELECT COUNT(*) AS total FROM agenda_events').total),
    2,
    'os dados-fonte não podem ser afetados pela exclusão do gráfico'
  );
});
