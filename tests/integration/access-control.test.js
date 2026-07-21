// ============================================================================
// Kairo — Auditoria de acesso: admin full, matriz de planos e plano padrão Free
// (Tarefa 37). Testa a fiação real de autorização através de `createApp`.
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { test } from 'node:test';
import { createApp } from '../../src/server/app.js';
import {
  ensureCoreSchema,
  ensureUserWorkspace,
  openSqliteClient,
  resetUserWorkspace
} from '../../src/server/database/index.js';
import { createAuthenticationMiddleware } from '../../src/server/middleware/authentication.js';
import { createRateLimiters } from '../../src/server/middleware/rate-limit.js';
import { createActivitiesService } from '../../src/server/modules/activities/activities.service.js';
import { createAgendaService } from '../../src/server/modules/agenda/agenda.service.js';
import { createAnalyticsService } from '../../src/server/modules/analytics/analytics.service.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { createChartsService } from '../../src/server/modules/charts/charts.service.js';
import { createDashboardService } from '../../src/server/modules/dashboard/dashboard.service.js';
import { createEnergyService } from '../../src/server/modules/energy/energy.service.js';
import { createGoogleCalendarService } from '../../src/server/modules/integrations/google-calendar/google-calendar.service.js';
import {
  createPlansService,
  ensurePlansSchema
} from '../../src/server/modules/plans/plans.service.js';
import { createPrivacyService } from '../../src/server/modules/privacy/privacy.service.js';
import { createProfileService } from '../../src/server/modules/profile/profile.service.js';
import {
  createRewardsService,
  ensureRewardsSchema
} from '../../src/server/modules/rewards/rewards.service.js';

const TIMEZONE = 'America/Sao_Paulo';
const SESSION_SECRET = 'segredo-de-acesso-com-mais-de-trinta-e-dois-bytes-2026';
const ADMIN_PASSWORD = 'senha-admin-acesso';
const USER_PASSWORD = 'senha-usuario-acesso';

function fakeGoogleClient() {
  class FakeOAuth2 extends EventEmitter {
    generateAuthUrl() {
      return 'https://accounts.google.test/o/oauth2/v2/auth';
    }
    setCredentials() {}
    async getToken() {
      return { tokens: {} };
    }
    async revokeToken() {
      return {};
    }
  }
  return {
    auth: { OAuth2: FakeOAuth2 },
    calendar: () => ({ events: { list: async () => ({ data: { items: [] } }) } })
  };
}

function buildConfig() {
  return {
    isProduction: false,
    nodeEnv: 'test',
    trustProxy: false,
    corsOrigins: [],
    cookie: { name: 'kairo.session', secure: false, sameSite: 'strict', domain: null },
    limits: { avatar: '1mb', json: '1mb' },
    google: { timezone: TIMEZONE }
  };
}

function createContext(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-acesso-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);

  const agendaService = createAgendaService({ db, timeZone: TIMEZONE });
  const analyticsService = createAnalyticsService(db);
  let googleReal = null;
  function criarGoogle() {
    googleReal ??= createGoogleCalendarService({
      db,
      config: {
        clientId: 'cliente-acesso',
        clientSecret: 'segredo-acesso',
        redirectUri: 'http://127.0.0.1:3000/api/google/callback',
        calendarId: 'primary',
        timezone: TIMEZONE
      },
      encryptionKey: randomBytes(32),
      googleClient: fakeGoogleClient(),
      agendaService
    });
    return googleReal;
  }

  const authService = createAuthService({
    db,
    sessionSecret: SESSION_SECRET,
    sessionTtlMs: 60 * 60 * 1000,
    allowFirstUserBootstrap: true,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
      ensureRewardsSchema(db);
      criarGoogle();
    }
  });

  const plansService = createPlansService(db);
  const services = {
    activities: createActivitiesService(db),
    agenda: agendaService,
    analytics: analyticsService,
    auth: authService,
    charts: createChartsService({ db, analyticsService }),
    dashboard: createDashboardService(db),
    energy: createEnergyService({ db }),
    plans: plansService,
    profile: createProfileService(db),
    rewards: createRewardsService({ db, timeZone: TIMEZONE }),
    googleCalendar: {
      getStatus: (...a) => criarGoogle().getStatus(...a),
      createAuthorization: (...a) => criarGoogle().createAuthorization(...a),
      handleCallback: (...a) => criarGoogle().handleCallback(...a),
      syncNow: (...a) => criarGoogle().syncNow(...a),
      disconnect: (...a) => criarGoogle().disconnect(...a),
      pushEvent: (...a) => criarGoogle().pushEvent(...a),
      deleteEvent: (...a) => criarGoogle().deleteEvent(...a),
      isConfigured: (...a) => criarGoogle().isConfigured(...a)
    }
  };
  services.privacy = createPrivacyService({
    db,
    authService,
    googleCalendarService: { disconnect: (userId) => criarGoogle().disconnect(userId) }
  });

  const authentication = createAuthenticationMiddleware({
    authService,
    cookieName: 'kairo.session'
  });
  const rateLimiters = createRateLimiters({ windowMs: 1000, max: 100000 });

  const app = createApp({
    config: buildConfig(),
    services,
    authentication,
    rateLimiters,
    resetWorkspace: (user) => resetUserWorkspace(db, user),
    domainStatus: () => ({ ready: true, bootstrapRequired: false }),
    logger: { error() {}, warn() {}, info() {} }
  });

  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return { app, db, plansService };
}

async function registrar(app, { name, email, password }) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/register')
    .send({ name, email, password })
    .expect(201);
  return { agent, csrfToken: response.body.csrfToken, user: response.body.user };
}

test('37.4 — primeira conta é admin/pro; demais nascem Free; payload não carrega plano', async (t) => {
  const context = createContext(t);
  // Primeira conta local: exceção documentada (administrador/pro).
  const admin = await registrar(context.app, {
    name: 'Administrador',
    email: 'admin@kairo.local',
    password: ADMIN_PASSWORD
  });
  assert.equal(admin.user.role, 'administrador');
  assert.equal(admin.user.plan, 'pro');

  // Segundo cadastro (fluxo limpo) → sempre Free/usuario.
  const comum = await registrar(context.app, {
    name: 'Usuária Comum',
    email: 'comum@kairo.local',
    password: USER_PASSWORD
  });
  assert.equal(comum.user.role, 'usuario');
  assert.equal(comum.user.plan, 'free');

  const persistido = context.db.get('SELECT role, plan FROM users WHERE email = ?', [
    'comum@kairo.local'
  ]);
  assert.equal(persistido.role, 'usuario');
  assert.equal(persistido.plan, 'free');

  // Tentativa de injetar plano/papel no payload é rejeitada pelo schema estrito (422),
  // impedindo qualquer escalonamento vindo do cliente.
  await request
    .agent(context.app)
    .post('/api/auth/register')
    .send({
      name: 'Malicioso',
      email: 'malicioso@kairo.local',
      password: USER_PASSWORD,
      plan: 'pro',
      role: 'administrador'
    })
    .expect(422);
  assert.equal(
    context.db.get('SELECT COUNT(*) AS total FROM users WHERE email = ?', ['malicioso@kairo.local'])
      .total,
    0,
    'cadastro com campos extras não pode criar usuário'
  );
});

test('37.1/37.2 — matriz de planos governa a UI e a API; admin nunca é limitado', async (t) => {
  const context = createContext(t);
  await registrar(context.app, {
    name: 'Administrador',
    email: 'admin@kairo.local',
    password: ADMIN_PASSWORD
  });
  const comum = await registrar(context.app, {
    name: 'Usuária Comum',
    email: 'comum@kairo.local',
    password: USER_PASSWORD
  });
  const adminAgent = request.agent(context.app);
  const adminLogin = await adminAgent
    .post('/api/auth/login')
    .send({ email: 'admin@kairo.local', password: ADMIN_PASSWORD })
    .expect(200);
  assert.ok(adminLogin.body.csrfToken);

  // Free tem 'reports' liberado por padrão → 200 (recurso que serve a seção Relatórios).
  await comum.agent.get('/api/charts').expect(200);

  // Admin desativa 'reports' para o plano free.
  context.plansService.toggleFeature({ plan_key: 'free', feature_key: 'reports', enabled: false });

  // Usuária free agora recebe negativa honesta na API (bypass de UI por URL direta).
  await comum.agent
    .get('/api/charts')
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'FUNCIONALIDADE_NAO_INCLUIDA'));
  await comum.agent
    .get('/api/analytics/timeseries?feature=work&period=weekly')
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'FUNCIONALIDADE_NAO_INCLUIDA'));

  // Administrador continua com acesso integral, mesmo com o recurso desativado na matriz.
  await adminAgent.get('/api/charts').expect(200);
});

test('37.1 — recurso nunca liberado a um plano bloqueia usuário mas não o admin', async (t) => {
  const context = createContext(t);
  await registrar(context.app, {
    name: 'Administrador',
    email: 'admin@kairo.local',
    password: ADMIN_PASSWORD
  });
  const comum = await registrar(context.app, {
    name: 'Usuária Comum',
    email: 'comum@kairo.local',
    password: USER_PASSWORD
  });

  // 'ai_assistant' não pertence ao plano free (matriz padrão) — porta ainda não montada,
  // então validamos a decisão de autorização diretamente no serviço de planos.
  assert.equal(context.plansService.planCan('free', 'ai_assistant', 'usuario'), false);
  assert.equal(context.plansService.planCan('free', 'ai_assistant', 'administrador'), true);
  assert.equal(context.plansService.planCan('free', 'google_calendar', 'usuario'), false);
  assert.equal(context.plansService.planCan('pro', 'ai_assistant', 'usuario'), true);

  // google_calendar não liberado ao free → 403 honesto na API real.
  await comum.agent
    .get('/api/google/status')
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'FUNCIONALIDADE_NAO_INCLUIDA'));
});
