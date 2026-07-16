// ============================================================================
// Kairo — Integração de autenticação, autorização, workspace e segurança HTTP
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
  openSqliteClient,
  resetUserWorkspace
} from '../../src/server/database/index.js';
import { createAuthenticationMiddleware } from '../../src/server/middleware/authentication.js';
import {
  apiNotFound,
  errorHandler,
  requestIdMiddleware
} from '../../src/server/middleware/error-handler.js';
import {
  additionalSecurityHeaders,
  apiNoStore,
  createCorsMiddleware,
  createHelmetMiddleware,
  rejectDisallowedOrigin,
  requireJsonBody
} from '../../src/server/middleware/http-security.js';
import { createRateLimiters } from '../../src/server/middleware/rate-limit.js';
import { createAuthRouter } from '../../src/server/modules/auth/auth.routes.js';
import {
  createAuthService,
  ensureAuthSchema
} from '../../src/server/modules/auth/auth.service.js';
import { createUsersRouter } from '../../src/server/modules/auth/users.routes.js';
import { createDashboardRouter } from '../../src/server/modules/dashboard/dashboard.routes.js';
import { createDashboardService } from '../../src/server/modules/dashboard/dashboard.service.js';
import { createPlansRouter } from '../../src/server/modules/plans/plans.routes.js';
import {
  createPlansService,
  ensurePlansSchema
} from '../../src/server/modules/plans/plans.service.js';
import { createProfileRouter } from '../../src/server/modules/profile/profile.routes.js';
import { createProfileService } from '../../src/server/modules/profile/profile.service.js';
import { createSettingsRouter } from '../../src/server/modules/settings/settings.routes.js';

const COOKIE_NAME = 'kairo.session';
const SESSION_SECRET = 'segredo-de-integracao-com-mais-de-trinta-e-dois-bytes-2026';
const ADMIN_PASSWORD = 'SenhaAdmin#2026';
const ALLOWED_ORIGIN = 'https://app.kairo.example';
const NO_LIMIT = (_req, _res, next) => next();

function validRegistration(overrides = {}) {
  return {
    name: 'Administrador Kairo',
    email: 'admin@kairo.local',
    password: ADMIN_PASSWORD,
    ...overrides
  };
}

function validManagedUser(overrides = {}) {
  return {
    name: 'Pessoa Gerenciada',
    email: 'pessoa@kairo.local',
    password: 'SenhaPessoa#2026',
    role: 'usuario',
    plan: 'plus',
    ...overrides
  };
}

function createContext(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-auth-http-test-'));
  const databasePath = path.join(directory, 'database.sqlite');
  const db = openSqliteClient(databasePath);
  ensureAuthSchema(db);
  ensurePlansSchema(db);

  const workspaceInitialization = [];
  const authService = createAuthService({
    db,
    sessionSecret: SESSION_SECRET,
    sessionTtlMs: 60 * 60 * 1000,
    recentAuthTtlMs: 10 * 60 * 1000,
    onUserCreated(user, context) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      const result = ensureUserWorkspace(db, user);
      workspaceInitialization.push({ userId: user.id, context, result });
    }
  });
  const plansService = createPlansService(db);
  const profileService = createProfileService(db);
  const dashboardService = createDashboardService(db);
  const authentication = createAuthenticationMiddleware({ authService, cookieName: COOKIE_NAME });

  const app = express();
  app.disable('x-powered-by');
  app.use((req, _res, next) => {
    const simulatedRemoteAddress = req.get('x-test-remote-address');
    if (simulatedRemoteAddress) {
      Object.defineProperty(req.socket, 'remoteAddress', {
        configurable: true,
        value: simulatedRemoteAddress
      });
    }
    next();
  });
  app.use(requestIdMiddleware);
  app.use(createHelmetMiddleware({ isProduction: false }));
  app.use(additionalSecurityHeaders);
  app.use(createCorsMiddleware([ALLOWED_ORIGIN]));
  app.use(rejectDisallowedOrigin([ALLOWED_ORIGIN]));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiNoStore, requireJsonBody);
  app.use('/api/auth', createAuthRouter({
    authService,
    ...authentication,
    cookieName: COOKIE_NAME,
    cookieOptions: { sameSite: 'strict', secure: false },
    loginLimiter: NO_LIMIT,
    registerLimiter: NO_LIMIT
  }));
  app.use('/api/users', createUsersRouter({
    authService,
    ...authentication,
    mutationLimiter: NO_LIMIT
  }));
  app.use('/api', createPlansRouter({
    plansService,
    authService,
    ...authentication,
    mutationLimiter: NO_LIMIT
  }));
  app.use('/api/profile', createProfileRouter({
    profileService,
    plansService,
    authService,
    ...authentication,
    mutationLimiter: NO_LIMIT
  }));
  app.use('/api/dashboard', createDashboardRouter({
    dashboardService,
    requireAuth: authentication.requireAuth
  }));
  app.use('/api/settings', createSettingsRouter({
    resetWorkspace: (user) => resetUserWorkspace(db, user),
    authService,
    ...authentication,
    sensitiveLimiter: NO_LIMIT
  }));
  app.use('/api', apiNotFound);
  app.use(errorHandler({ logger: { error: () => {} }, isDevelopment: false }));

  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return {
    app,
    authService,
    dashboardService,
    db,
    directory,
    plansService,
    profileService,
    workspaceInitialization
  };
}

async function bootstrapAdministrator(context) {
  const agent = request.agent(context.app);
  const response = await agent
    .post('/api/auth/register')
    .send(validRegistration())
    .expect(201);
  return {
    agent,
    csrfToken: response.body.csrfToken,
    response,
    user: response.body.user
  };
}

async function reauthenticate(agent, csrfToken, password = ADMIN_PASSWORD) {
  return agent
    .post('/api/auth/reauthenticate')
    .set('x-csrf-token', csrfToken)
    .send({ password });
}

test('bootstrap administrativo é local, sessão usa cookie seguro e logout revoga acesso', async (t) => {
  const context = createContext(t);

  await request(context.app)
    .post('/api/auth/register')
    .send({ ...validRegistration(), role: 'administrador', plan: 'pro', user_id: 999 })
    .expect(422)
    .expect(({ body }) => assert.equal(body.error.code, 'VALIDACAO_FALHOU'));
  assert.equal(context.authService.bootstrapRequired(), true);

  await request(context.app)
    .post('/api/auth/register')
    .set('x-test-remote-address', '203.0.113.25')
    .send(validRegistration({ email: 'remoto@kairo.local' }))
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'BOOTSTRAP_LOCAL_NECESSARIO'));
  assert.equal(context.authService.bootstrapRequired(), true);

  const { agent, csrfToken, response, user } = await bootstrapAdministrator(context);
  assert.equal(response.body.bootstrapCompleted, true);
  assert.equal(user.role, 'administrador');
  assert.equal(user.plan, 'pro');
  assert.equal(context.authService.bootstrapRequired(), false);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/i);
  assert.match(response.headers['set-cookie'][0], /SameSite=Strict/i);
  assert.doesNotMatch(response.headers['set-cookie'][0], /Domain=/i);
  const originalSessionCookie = response.headers['set-cookie'][0].split(';', 1)[0];
  assert.deepEqual(context.workspaceInitialization[0].result, { created: true, activities: 6 });

  await agent
    .get('/api/auth/me')
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.id, user.id);
      assert.equal(body.email, 'admin@kairo.local');
      assert.equal(body.password_hash, undefined);
    });

  await agent
    .post('/api/auth/logout')
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'CSRF_INVALIDO'));
  await agent.get('/api/auth/me').expect(200);

  const activeSession = context.db.get(
    'SELECT id FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL',
    [user.id]
  );
  await agent
    .post('/api/auth/logout')
    .set('x-csrf-token', csrfToken)
    .expect(204);
  assert.ok(context.db.get(
    'SELECT revoked_at FROM auth_sessions WHERE id = ?',
    [activeSession.id]
  ).revoked_at);
  await request(context.app)
    .get('/api/auth/me')
    .set('Cookie', originalSessionCookie)
    .expect(401)
    .expect(({ body }) => assert.equal(body.error.code, 'SESSAO_REVOGADA'));
  await agent
    .get('/api/auth/me')
    .expect(401)
    .expect(({ body }) => assert.equal(body.error.code, 'NAO_AUTENTICADO'));

  await agent
    .post('/api/auth/login')
    .send({ email: 'admin@kairo.local', password: 'SenhaErrada#2026' })
    .expect(401)
    .expect(({ body }) => assert.equal(body.error.code, 'CREDENCIAIS_INVALIDAS'));
  const loggedIn = await agent
    .post('/api/auth/login')
    .send({ email: 'ADMIN@KAIRO.LOCAL', password: ADMIN_PASSWORD })
    .expect(200);
  assert.equal(loggedIn.body.user.id, user.id);
  assert.ok(context.db.get(
    "SELECT COUNT(*) AS total FROM audit_events WHERE action = 'auth.login' AND result = 'falha'"
  ).total >= 1);
});

test('administração preserva separação entre papel e plano, protege último admin e aplica autorização recente', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken, user: administrator } = await bootstrapAdministrator(context);

  await agent
    .post('/api/users')
    .send(validManagedUser())
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'CSRF_INVALIDO'));
  await agent
    .post('/api/users')
    .set('x-csrf-token', csrfToken)
    .send(validManagedUser())
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'REAUTENTICACAO_NECESSARIA'));

  await reauthenticate(agent, csrfToken, 'SenhaIncorreta#2026')
    .then((response) => {
      assert.equal(response.status, 401);
      assert.equal(response.body.error.code, 'REAUTENTICACAO_INVALIDA');
    });
  await reauthenticate(agent, csrfToken).then((response) => assert.equal(response.status, 200));

  await agent
    .put(`/api/users/${administrator.id}`)
    .set('x-csrf-token', csrfToken)
    .send({ role: 'usuario' })
    .expect(409)
    .expect(({ body }) => assert.equal(body.error.code, 'ULTIMO_ADMINISTRADOR'));

  const created = await agent
    .post('/api/users')
    .set('x-csrf-token', csrfToken)
    .send(validManagedUser())
    .expect(201);
  assert.equal(created.body.role, 'usuario');
  assert.equal(created.body.plan, 'plus');
  const managedSession = await context.authService.login({
    email: 'pessoa@kairo.local',
    password: 'SenhaPessoa#2026'
  }, { ip: '127.0.0.1', headers: { 'user-agent': 'sessao-pessoa-gerenciada' } });
  await request(context.app)
    .get('/api/users')
    .set('Cookie', `${COOKIE_NAME}=${managedSession.token}`)
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'ADMINISTRADOR_NECESSARIO'));

  const planChanged = await agent
    .put(`/api/users/${created.body.id}`)
    .set('x-csrf-token', csrfToken)
    .send({ plan: 'pro' })
    .expect(200);
  assert.equal(planChanged.body.role, 'usuario');
  assert.equal(planChanged.body.plan, 'pro');
  assert.equal(context.authService.authenticate(managedSession.token).user.plan, 'pro');

  const promoted = await agent
    .put(`/api/users/${created.body.id}`)
    .set('x-csrf-token', csrfToken)
    .send({ role: 'administrador' })
    .expect(200);
  assert.equal(promoted.body.role, 'administrador');
  assert.equal(promoted.body.plan, 'pro');
  assert.throws(
    () => context.authService.authenticate(managedSession.token),
    (error) => error.code === 'SESSAO_REVOGADA'
  );

  await agent
    .post('/api/users')
    .set('x-csrf-token', csrfToken)
    .send(validManagedUser({ email: 'plano-invalido@kairo.local', plan: 'inexistente' }))
    .expect(422)
    .expect(({ body }) => assert.equal(body.error.code, 'PLANO_INVALIDO'));

  const feature = await agent
    .post('/api/features')
    .set('x-csrf-token', csrfToken)
    .send({ key: 'foco_premium', label: 'Foco premium' })
    .expect(201);
  assert.equal(feature.body.key, 'foco_premium');
  await agent
    .post('/api/plans')
    .set('x-csrf-token', csrfToken)
    .send({ key: 'elite', name: 'Elite', price: 5900, description: 'Plano empresarial.' })
    .expect(201);
  assert.equal(context.plansService.planCan('elite', 'foco_premium', 'usuario'), false);
  await agent
    .post('/api/plans/toggle')
    .set('x-csrf-token', csrfToken)
    .send({ plan_key: 'elite', feature_key: 'foco_premium', enabled: true })
    .expect(200);
  assert.equal(context.plansService.planCan('elite', 'foco_premium', 'usuario'), true);
  assert.equal(context.plansService.planCan('free', 'ai_assistant', 'administrador'), true);

  await agent
    .delete('/api/plans/free')
    .set('x-csrf-token', csrfToken)
    .expect(409)
    .expect(({ body }) => assert.equal(body.error.code, 'PLANO_PADRAO_PROTEGIDO'));
  await agent
    .delete(`/api/users/${created.body.id}`)
    .set('x-csrf-token', csrfToken)
    .expect(204);
  assert.equal(context.db.get('SELECT COUNT(*) AS total FROM users WHERE id = ?', [created.body.id]).total, 0);
});

test('preferências pessoais dispensam reautenticação, mas preservam autenticação, CSRF, contrato e isolamento', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken, user: administrator } = await bootstrapAdministrator(context);
  const isolatedPassword = 'SenhaIsolada#2026';
  const secondRegistration = await context.authService.register({
    name: 'Pessoa Isolada',
    email: 'isolada@kairo.local',
    password: isolatedPassword
  }, { ip: '127.0.0.1', headers: { 'user-agent': 'teste-preferencias-isoladas' } });
  const administratorBefore = context.profileService.get(administrator.id);
  const secondProfileBefore = context.profileService.get(secondRegistration.user.id);
  const preferences = {
    theme: 'claro',
    focus_sound: 'ondas',
    enable_confetti: false
  };

  await request(context.app)
    .put('/api/profile/preferences')
    .set('x-csrf-token', csrfToken)
    .send(preferences)
    .expect(401)
    .expect(({ body }) => assert.equal(body.error.code, 'NAO_AUTENTICADO'));

  await agent
    .put('/api/profile/preferences')
    .send(preferences)
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'CSRF_INVALIDO'));
  assert.deepEqual(context.profileService.get(administrator.id), administratorBefore);

  await agent
    .put('/api/profile/preferences')
    .set('x-csrf-token', csrfToken)
    .send({ ...preferences, username: 'Campo indevido' })
    .expect(422)
    .expect(({ body }) => assert.equal(body.error.code, 'VALIDACAO_FALHOU'));
  assert.deepEqual(context.profileService.get(administrator.id), administratorBefore);

  await agent
    .put('/api/profile')
    .set('x-csrf-token', csrfToken)
    .send({
      username: administratorBefore.username,
      email: administratorBefore.email,
      avatar: administratorBefore.avatar
    })
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'REAUTENTICACAO_NECESSARIA'));

  const response = await agent
    .put('/api/profile/preferences')
    .set('x-csrf-token', csrfToken)
    .send(preferences)
    .expect(200);
  assert.equal(response.body.message, 'Preferências atualizadas com sucesso.');
  assert.equal(response.body.profile.username, administratorBefore.username);
  assert.equal(response.body.profile.email, administratorBefore.email);
  assert.equal(response.body.profile.theme, 'claro');
  assert.equal(response.body.profile.focus_sound, 'ondas');
  assert.equal(response.body.profile.enable_confetti, false);
  assert.deepEqual(context.profileService.get(secondRegistration.user.id), secondProfileBefore);

  const auditEvent = context.db.get(
    `SELECT actor_user_id, target_user_id, metadata_json
     FROM audit_events
     WHERE action = 'profile.preferences.update'
     ORDER BY id DESC
     LIMIT 1`
  );
  assert.equal(auditEvent.actor_user_id, administrator.id);
  assert.equal(auditEvent.target_user_id, administrator.id);
  assert.deepEqual(JSON.parse(auditEvent.metadata_json), {
    campos: ['theme', 'focus_sound', 'enable_confetti']
  });
  assert.doesNotMatch(auditEvent.metadata_json, /claro|ondas|false|@kairo\.local/i);

  const isolatedAgent = request.agent(context.app);
  const isolatedLogin = await isolatedAgent
    .post('/api/auth/login')
    .send({ email: 'isolada@kairo.local', password: isolatedPassword })
    .expect(200);
  const isolatedCsrfToken = isolatedLogin.body.csrfToken;

  await isolatedAgent
    .put('/api/profile/preferences')
    .set('x-csrf-token', isolatedCsrfToken)
    .send({ ...preferences, focus_sound: 'binaural' })
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'FUNCIONALIDADE_NAO_INCLUIDA'));
  assert.deepEqual(context.profileService.get(secondRegistration.user.id), secondProfileBefore);

  const isolatedAllowed = await isolatedAgent
    .put('/api/profile/preferences')
    .set('x-csrf-token', isolatedCsrfToken)
    .send({ ...preferences, focus_sound: 'ruido' })
    .expect(200);
  assert.equal(isolatedAllowed.body.profile.focus_sound, 'ruido');
  assert.equal(isolatedAllowed.body.profile.theme, 'claro');
  assert.equal(isolatedAllowed.body.profile.enable_confetti, false);
});

test('perfil, indicadores e reset permanecem estritamente isolados por usuário', async (t) => {
  const context = createContext(t);
  const { agent, csrfToken, user: administrator } = await bootstrapAdministrator(context);
  await reauthenticate(agent, csrfToken).then((response) => assert.equal(response.status, 200));

  const secondRegistration = await context.authService.register({
    name: 'Segunda Pessoa',
    email: 'segunda@kairo.local',
    password: 'SenhaSegunda#2026'
  }, { ip: '127.0.0.1', headers: { 'user-agent': 'teste-integracao' } });
  const secondUser = secondRegistration.user;
  const secondProfileBefore = context.profileService.get(secondUser.id);
  const secondaryAdminSession = await context.authService.login(
    { email: 'admin@kairo.local', password: ADMIN_PASSWORD },
    { ip: '127.0.0.1', headers: { 'user-agent': 'sessao-secundaria' } }
  );

  const minimalPng = `data:image/png;base64,${Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]).toString('base64')}`;
  const updatedProfile = await agent
    .put('/api/profile')
    .set('x-csrf-token', csrfToken)
    .send({
      username: 'Administrador Atualizado',
      email: 'admin.atualizado@kairo.local',
      avatar: minimalPng
    })
    .expect(200);
  assert.equal(updatedProfile.body.profile.username, 'Administrador Atualizado');
  assert.equal(updatedProfile.body.profile.enable_confetti, true);

  const updatedPreferences = await agent
    .put('/api/profile/preferences')
    .set('x-csrf-token', csrfToken)
    .send({
      theme: 'claro',
      focus_sound: 'ondas',
      enable_confetti: false
    })
    .expect(200);
  assert.equal(updatedPreferences.body.profile.username, 'Administrador Atualizado');
  assert.equal(updatedPreferences.body.profile.enable_confetti, false);
  assert.deepEqual(context.profileService.get(secondUser.id), secondProfileBefore);
  assert.throws(
    () => context.authService.authenticate(secondaryAdminSession.token),
    (error) => error.code === 'SESSAO_REVOGADA'
  );
  await agent
    .get('/api/auth/me')
    .expect(200)
    .expect(({ body }) => assert.equal(body.email, 'admin.atualizado@kairo.local'));

  const adminActivity = context.db.get(
    'SELECT id FROM activities WHERE user_id = ? ORDER BY id LIMIT 1',
    [administrator.id]
  );
  const secondActivity = context.db.get(
    'SELECT id FROM activities WHERE user_id = ? ORDER BY id LIMIT 1',
    [secondUser.id]
  );
  context.db.run(
    "UPDATE timeframes SET current = 4.5 WHERE activity_id = ? AND type = 'daily'",
    [adminActivity.id]
  );
  context.db.run(
    "UPDATE timeframes SET current = 99 WHERE activity_id = ? AND type = 'daily'",
    [secondActivity.id]
  );
  await agent
    .get('/api/dashboard/kpis')
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.dailyTotal, 4.5);
      assert.equal(body.activityCount, 6);
    });

  context.db.run(
    'INSERT INTO activities (user_id, title) VALUES (?, ?)',
    [administrator.id, 'Temporária do administrador']
  );
  const privateSecondActivity = context.db.run(
    'INSERT INTO activities (user_id, title) VALUES (?, ?)',
    [secondUser.id, 'Privada da segunda pessoa']
  ).lastID;
  await agent
    .post('/api/settings/reset')
    .set('x-csrf-token', csrfToken)
    .expect(200)
    .expect(({ body }) => assert.equal(body.activitiesCreated, 6));

  assert.equal(
    context.db.get('SELECT COUNT(*) AS total FROM activities WHERE user_id = ?', [administrator.id]).total,
    6
  );
  assert.equal(
    context.db.get('SELECT COUNT(*) AS total FROM activities WHERE id = ? AND user_id = ?', [
      privateSecondActivity,
      secondUser.id
    ]).total,
    1
  );
  assert.equal(context.profileService.get(administrator.id).username, 'Administrador Atualizado');
  assert.equal(context.profileService.get(administrator.id).theme, 'escuro');
});

test('autenticação recente rejeita confirmações expiradas e timestamps futuros', (t) => {
  const context = createContext(t);
  assert.equal(context.authService.hasRecentAuthentication({
    reauthenticatedAt: new Date(Date.now() - 60_000).toISOString()
  }), true);
  assert.equal(context.authService.hasRecentAuthentication({
    reauthenticatedAt: new Date(Date.now() - 11 * 60_000).toISOString()
  }), false);
  assert.equal(context.authService.hasRecentAuthentication({
    reauthenticatedAt: new Date(Date.now() + 60_000).toISOString()
  }), false);
});

test('headers, CORS, origem, JSON, 404 e erros internos não expõem detalhes sensíveis', async (t) => {
  const loggedErrors = [];
  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(createHelmetMiddleware({ isProduction: true }));
  app.use(additionalSecurityHeaders);
  app.use(createCorsMiddleware([ALLOWED_ORIGIN]));
  app.use(rejectDisallowedOrigin([ALLOWED_ORIGIN]));
  app.use(express.json());
  app.use('/api', apiNoStore, requireJsonBody);
  app.get('/api/ok', (_req, res) => res.json({ ok: true }));
  app.post('/api/echo', (req, res) => res.json(req.body));
  app.get('/api/falha-interna', () => {
    throw new Error('senha-do-banco-supersecreta');
  });
  app.use('/api', apiNotFound);
  app.use(errorHandler({ logger: { error: (entry) => loggedErrors.push(entry) }, isDevelopment: true }));

  const allowed = await request(app)
    .get('/api/ok')
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-request-id', 'requisicao-segura-2026')
    .expect(200);
  assert.equal(allowed.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  assert.equal(allowed.headers['x-request-id'], 'requisicao-segura-2026');
  assert.equal(allowed.headers['cache-control'], 'no-store');
  assert.equal(allowed.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=(), payment=()');
  assert.match(allowed.headers['content-security-policy'], /fonts\.googleapis\.com/);
  assert.match(allowed.headers['content-security-policy'], /fonts\.gstatic\.com/);
  assert.match(allowed.headers['strict-transport-security'], /max-age=31536000/);
  assert.equal(allowed.headers['x-powered-by'], undefined);

  await request(app)
    .get('/api/ok')
    .set('Origin', 'https://origem-maliciosa.example')
    .expect(403)
    .expect(({ body, headers }) => {
      assert.equal(body.error.code, 'ORIGEM_NAO_PERMITIDA');
      assert.equal(headers['access-control-allow-origin'], undefined);
    });

  await request(app)
    .post('/api/echo')
    .set('Content-Type', 'text/plain')
    .send('não é JSON')
    .expect(400)
    .expect(({ body }) => assert.equal(body.error.code, 'CONTENT_TYPE_INVALIDO'));
  await request(app)
    .post('/api/echo')
    .set('Content-Type', 'application/json')
    .send('{"json":')
    .expect(400)
    .expect(({ body }) => assert.equal(body.error.code, 'JSON_INVALIDO'));
  await request(app)
    .get('/api/rota-inexistente')
    .expect(404)
    .expect(({ body }) => assert.equal(body.error.code, 'ROTA_NAO_ENCONTRADA'));

  const failure = await request(app)
    .get('/api/falha-interna')
    .set('x-request-id', 'curto')
    .expect(500);
  assert.equal(failure.body.error.code, 'ERRO_INTERNO');
  assert.equal(failure.body.error.message, 'Não foi possível concluir a operação.');
  assert.doesNotMatch(JSON.stringify(failure.body), /senha-do-banco-supersecreta/);
  assert.match(failure.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0].erro, 'senha-do-banco-supersecreta');
});

test('rate limit retorna contrato JSON auditável e cabeçalhos padronizados', async () => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(createRateLimiters({ windowMs: 60_000, generalLimit: 1 }).general);
  app.get('/recurso', (_req, res) => res.json({ ok: true }));

  await request(app).get('/recurso').expect(200);
  const blocked = await request(app).get('/recurso').expect(429);
  assert.equal(blocked.body.error.code, 'LIMITE_EXCEDIDO');
  assert.equal(blocked.body.error.requestId, blocked.headers['x-request-id']);
  assert.ok(blocked.headers.ratelimit || blocked.headers['ratelimit-policy']);
});
