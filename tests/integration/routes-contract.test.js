// ============================================================================
// Kairo — Contratos HTTP das rotas ainda sem cobertura de integração dedicada
// ============================================================================
//
// Fecha o item da Tarefa 32 "ampliar contratos automatizados até cobrir todas
// as rotas atuais". Cada bloco valida o contrato real (status, corpo e regras
// de autorização) montando os routers verdadeiros sobre banco SQLite isolado.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
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
import { createAuthRouter } from '../../src/server/modules/auth/auth.routes.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { createGoogleCalendarRouter } from '../../src/server/modules/integrations/google-calendar/google-calendar.routes.js';
import { createGoogleCalendarService } from '../../src/server/modules/integrations/google-calendar/google-calendar.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';
import { createProfileRouter } from '../../src/server/modules/profile/profile.routes.js';
import { createProfileService } from '../../src/server/modules/profile/profile.service.js';
import { createPlansService } from '../../src/server/modules/plans/plans.service.js';
import { createRewardsRouter } from '../../src/server/modules/rewards/rewards.routes.js';
import {
  createRewardsService,
  ensureRewardsSchema
} from '../../src/server/modules/rewards/rewards.service.js';

const COOKIE_NAME = 'kairo.session';
const SESSION_SECRET = 'segredo-de-contrato-de-rotas-com-mais-de-trinta-e-dois-bytes';
const ADMIN_PASSWORD = 'senha-admin-contratos';
const TIMEZONE = 'America/Sao_Paulo';
const NO_LIMIT = (_req, _res, next) => next();

function createFakeGoogleClient() {
  class FakeOAuth2 extends EventEmitter {
    constructor(clientId, clientSecret, redirectUri) {
      super();
      this.clientId = clientId;
      this.clientSecret = clientSecret;
      this.redirectUri = redirectUri;
      this.credentials = {};
    }

    generateAuthUrl(authOptions) {
      const url = new URL('https://accounts.google.test/o/oauth2/v2/auth');
      url.searchParams.set('state', authOptions.state);
      return url.toString();
    }

    setCredentials(credentials) {
      this.credentials = credentials;
    }

    async getToken() {
      return { tokens: {} };
    }

    async revokeToken() {
      return {};
    }
  }

  return {
    auth: { OAuth2: FakeOAuth2 },
    calendar: () => ({
      events: {
        list: async () => ({ data: { items: [] } }),
        insert: async () => ({ data: { id: 'evento-falso' } }),
        update: async () => ({ data: {} }),
        delete: async () => ({ data: {} })
      }
    })
  };
}

function createContext(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-rotas-contrato-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);

  const plansService = createPlansService(db);
  const profileService = createProfileService(db);
  const activitiesService = createActivitiesService(db);
  const agendaService = createAgendaService({ db, timeZone: TIMEZONE });
  const rewardsService = createRewardsService({ db, timeZone: TIMEZONE });

  // Como no runtime real, o serviço Google só é criado depois que o schema
  // central existe (a criação dele migra a coluna criptografada da tabela
  // google_tokens). O wrapper adiado delega para a instância real sob demanda.
  let googleReal = null;
  function criarServicoGoogle() {
    googleReal ??= createGoogleCalendarService({
      db,
      config: {
        clientId: 'cliente-google-de-contrato',
        clientSecret: 'segredo-google-de-contrato',
        redirectUri: 'http://127.0.0.1:3000/api/google/callback',
        calendarId: 'primary',
        timezone: TIMEZONE
      },
      encryptionKey: randomBytes(32),
      googleClient: createFakeGoogleClient(),
      agendaService
    });
    return googleReal;
  }
  const googleCalendarService = {
    getStatus: (...a) => criarServicoGoogle().getStatus(...a),
    createAuthorization: (...a) => criarServicoGoogle().createAuthorization(...a),
    handleCallback: (...a) => criarServicoGoogle().handleCallback(...a),
    syncNow: (...a) => criarServicoGoogle().syncNow(...a),
    disconnect: (...a) => criarServicoGoogle().disconnect(...a)
  };

  const authService = createAuthService({
    db,
    sessionSecret: SESSION_SECRET,
    sessionTtlMs: 60 * 60 * 1000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
      ensureRewardsSchema(db);
      criarServicoGoogle();
    }
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
    '/api/profile',
    createProfileRouter({
      profileService,
      plansService,
      authService,
      ...authentication,
      mutationLimiter: NO_LIMIT
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
    createAgendaRouter({
      agendaService,
      ...authentication,
      mutationLimiter: NO_LIMIT
    })
  );
  app.use(
    '/api',
    createRewardsRouter({
      rewardsService,
      authService,
      ...authentication,
      mutationLimiter: NO_LIMIT
    })
  );
  app.use(
    '/api/google',
    createGoogleCalendarRouter({
      googleCalendarService,
      authService,
      ...authentication,
      mutationLimiter: NO_LIMIT,
      sensitiveLimiter: NO_LIMIT,
      successRedirect: '/app',
      errorRedirect: '/app'
    })
  );
  app.use('/api', apiNotFound);
  app.use(errorHandler({ logger: { error: () => {} }, isDevelopment: false }));

  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return { app, db };
}

async function entrarComoAdministrador(context) {
  const agent = request.agent(context.app);
  const response = await agent
    .post('/api/auth/register')
    .send({ name: 'Admin Contratos', email: 'admin@contratos.local', password: ADMIN_PASSWORD })
    .expect(201);
  return { agent, csrfToken: response.body.csrfToken };
}

test('contratos públicos de auth: /status e /csrf respondem com o formato correto', async (t) => {
  const context = createContext(t);

  await request(context.app)
    .get('/api/auth/status')
    .expect(200)
    .expect(({ body }) => assert.equal(body.bootstrapRequired, true));

  const { agent } = await entrarComoAdministrador(context);

  await request(context.app)
    .get('/api/auth/status')
    .expect(200)
    .expect(({ body }) => assert.equal(body.bootstrapRequired, false));

  await agent
    .get('/api/auth/csrf')
    .expect(200)
    .expect(({ body }) => {
      assert.equal(typeof body.csrfToken, 'string');
      assert.ok(body.csrfToken.length > 10);
    });
});

test('contrato de troca de senha própria: senha errada nega, certa troca e revoga as demais sessões', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await entrarComoAdministrador(context);

  await agent
    .put('/api/profile/password')
    .set('x-csrf-token', csrfToken)
    .send({ currentPassword: 'senha-incorreta', newPassword: 'nova-senha-8' })
    .expect(401)
    .expect(({ body }) => assert.equal(body.error.code, 'SENHA_ATUAL_INVALIDA'));

  await agent
    .put('/api/profile/password')
    .set('x-csrf-token', csrfToken)
    .send({ currentPassword: ADMIN_PASSWORD, newPassword: 'no' })
    .expect(422);

  await agent
    .put('/api/profile/password')
    .set('x-csrf-token', csrfToken)
    .send({ currentPassword: ADMIN_PASSWORD, newPassword: 'nova-senha-8' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.message, 'Senha alterada com sucesso.'));

  await request(context.app)
    .post('/api/auth/login')
    .send({ email: 'admin@contratos.local', password: ADMIN_PASSWORD })
    .expect(401);

  await request(context.app)
    .post('/api/auth/login')
    .send({ email: 'admin@contratos.local', password: 'nova-senha-8' })
    .expect(200);
});

test('contratos de atividades: detalhes reais e definição de meta por período', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await entrarComoAdministrador(context);

  const created = await agent
    .post('/api/activities')
    .set('x-csrf-token', csrfToken)
    .send({ title: 'Atividade de contrato' })
    .expect(201);
  const activityId = created.body.id;

  await agent
    .put(`/api/activities/${activityId}/goals`)
    .set('x-csrf-token', csrfToken)
    .send({ timeframe: 'weekly', target_hours: 7.5 })
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.goal.type, 'weekly');
      assert.equal(body.goal.target_hours, 7.5);
    });

  await agent
    .get(`/api/activities/${activityId}/details`)
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.id, activityId);
      assert.ok(body.timeframes);
      assert.equal(body.goals.weekly, 7.5);
    });

  await agent.get('/api/activities/999999/details').expect(404);
});

test('contratos de categorias (Tarefa 19): criação com cor e ícone, edição de metadados e validações', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await entrarComoAdministrador(context);

  // Criação com cor e ícone reais.
  const criada = await agent
    .post('/api/activities')
    .set('x-csrf-token', csrfToken)
    .send({ title: 'Leitura Técnica', color: '#38bdf8', icon: '📚' })
    .expect(201);
  assert.equal(criada.body.color, '#38bdf8');
  assert.equal(criada.body.icon, '📚');
  const activityId = criada.body.id;

  // A cor e o ícone persistem e voltam na listagem.
  await agent
    .get('/api/activities')
    .expect(200)
    .expect(({ body }) => {
      const alvo = body.find((atividade) => atividade.id === activityId);
      assert.equal(alvo.color, '#38bdf8');
      assert.equal(alvo.icon, '📚');
    });

  // Edição de metadados: novo nome, nova cor e remoção do ícone (null).
  await agent
    .put(`/api/activities/${activityId}/meta`)
    .set('x-csrf-token', csrfToken)
    .send({ title: 'Leitura Profunda', color: '#7c6fff', icon: null })
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.activity.title, 'Leitura Profunda');
      assert.equal(body.activity.color, '#7c6fff');
      assert.equal(body.activity.icon, null);
    });

  // Cor em formato inválido é rejeitada (422).
  await agent
    .put(`/api/activities/${activityId}/meta`)
    .set('x-csrf-token', csrfToken)
    .send({ color: 'azul' })
    .expect(422);

  // Corpo vazio é rejeitado (pelo menos um campo é obrigatório).
  await agent
    .put(`/api/activities/${activityId}/meta`)
    .set('x-csrf-token', csrfToken)
    .send({})
    .expect(422);

  // Título duplicado retorna conflito (409).
  await agent
    .post('/api/activities')
    .set('x-csrf-token', csrfToken)
    .send({ title: 'Categoria Única' })
    .expect(201);
  await agent
    .put(`/api/activities/${activityId}/meta`)
    .set('x-csrf-token', csrfToken)
    .send({ title: 'Categoria Única' })
    .expect(409)
    .expect(({ body }) => assert.equal(body.error.code, 'ATIVIDADE_DUPLICADA'));
});

test('contratos de agenda: lista por atividade e conclusão/reabertura de compromisso', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await entrarComoAdministrador(context);

  const created = await agent
    .post('/api/activities')
    .set('x-csrf-token', csrfToken)
    .send({ title: 'Atividade com agenda' })
    .expect(201);
  const activityId = created.body.id;

  const event = await agent
    .post('/api/agenda')
    .set('x-csrf-token', csrfToken)
    .send({
      title: 'Compromisso de contrato',
      event_date: new Date().toISOString().slice(0, 10),
      start_time: '09:00',
      end_time: '10:00',
      activity_id: activityId
    })
    .expect(201);
  const eventId = event.body.id ?? event.body.event?.id;
  assert.ok(eventId, 'o compromisso criado deve expor id');

  await agent
    .get(`/api/activities/${activityId}/agenda`)
    .expect(200)
    .expect(({ body }) => {
      const lista = Array.isArray(body) ? body : body.events;
      assert.ok(Array.isArray(lista));
      assert.equal(lista.length, 1);
    });

  await agent
    .patch(`/api/agenda/${eventId}/completion`)
    .set('x-csrf-token', csrfToken)
    .send({ is_completed: true })
    .expect(200)
    .expect(({ body }) => assert.ok(body.event.is_completed));

  await agent
    .patch(`/api/agenda/${eventId}/completion`)
    .set('x-csrf-token', csrfToken)
    .send({ is_completed: false })
    .expect(200)
    .expect(({ body }) => assert.ok(!body.event.is_completed));
});

test('contratos de recompensas: estado, conclusão, feedback e superfícies administrativas', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await entrarComoAdministrador(context);

  await agent
    .get('/api/rewards/state')
    .expect(200)
    .expect(({ body }) => {
      assert.ok(body, 'o estado de recompensas deve responder um objeto');
    });

  const created = await agent
    .post('/api/activities')
    .set('x-csrf-token', csrfToken)
    .send({ title: 'Atividade recompensada' })
    .expect(201);

  const event = await agent
    .post('/api/agenda')
    .set('x-csrf-token', csrfToken)
    .send({
      title: 'Compromisso recompensado',
      event_date: new Date().toISOString().slice(0, 10),
      start_time: '11:00',
      end_time: '12:00',
      activity_id: created.body.id
    })
    .expect(201);
  const eventId = event.body.id ?? event.body.event?.id;

  // Contrato real: a recompensa só é gerada para compromisso efetivamente
  // concluído; concluir antes de registrar a conclusão recompensada.
  await agent
    .patch(`/api/agenda/${eventId}/completion`)
    .set('x-csrf-token', csrfToken)
    .send({ is_completed: true })
    .expect(200);

  const reward = await agent
    .post('/api/rewards/complete')
    .set('x-csrf-token', csrfToken)
    .send({ agenda_event_id: eventId })
    .expect(200);
  assert.ok(reward.body.event_id, 'a conclusão deve gerar um evento de recompensa');

  await agent
    .post('/api/rewards/feedback')
    .set('x-csrf-token', csrfToken)
    .send({ event_id: reward.body.event_id, rating: 5 })
    .expect(200)
    .expect(({ body }) => assert.equal(body.ok, true));

  await agent
    .post('/api/rewards/ai')
    .set('x-csrf-token', csrfToken)
    .send({ key: 'nao_repetir', value: true })
    .expect(200);

  await agent
    .get('/api/rewards/dashboard')
    .expect(200)
    .expect(({ body }) => assert.ok(body, 'o dashboard executivo deve responder'));

  const comum = request.agent(context.app);
  await comum
    .post('/api/auth/register')
    .send({ name: 'Pessoa Comum', email: 'comum@contratos.local', password: 'senha-comum' })
    .expect(201);
  await comum.get('/api/rewards/dashboard').expect(403);
});

test('contratos Google Agenda: status honesto, sync e disconnect sem conexão negam com código claro', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken } = await entrarComoAdministrador(context);

  await request(context.app).get('/api/google/status').expect(401);

  await agent
    .get('/api/google/status')
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.configured, true);
      assert.equal(body.connected, false);
    });

  await agent
    .post('/api/google/sync')
    .set('x-csrf-token', csrfToken)
    .send({})
    .expect(({ status, body }) => {
      assert.ok(status >= 400 && status < 500, `sync sem conexão deve negar (status ${status})`);
      assert.equal(body.error.code, 'GOOGLE_NAO_CONECTADO');
    });

  // Contrato real: desconectar sem conexão é idempotente e responde 204.
  await agent.post('/api/google/disconnect').set('x-csrf-token', csrfToken).send({}).expect(204);
});
