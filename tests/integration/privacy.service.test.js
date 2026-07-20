// ============================================================================
// Kairo — Integração de privacidade: exclusão de conta, retenção e pedidos
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
import { createAuthRouter } from '../../src/server/modules/auth/auth.routes.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';
import { createPrivacyRouter } from '../../src/server/modules/privacy/privacy.routes.js';
import {
  POLITICAS_DE_RETENCAO,
  createPrivacyService
} from '../../src/server/modules/privacy/privacy.service.js';
import { ensureRewardsSchema } from '../../src/server/modules/rewards/rewards.service.js';

const COOKIE_NAME = 'kairo.session';
const SESSION_SECRET = 'segredo-privacidade-com-mais-de-trinta-e-dois-bytes-2026';
const NO_LIMIT = (_req, _res, next) => next();
const FRASE = 'EXCLUIR MINHA CONTA';

function createContext(t, { googleDisconnect } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-privacidade-'));
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
      ensureRewardsSchema(db);
    }
  });
  const activitiesService = createActivitiesService(db);
  const agendaService = createAgendaService({ db, timeZone: 'America/Sao_Paulo' });
  const privacyService = createPrivacyService({
    db,
    authService,
    googleCalendarService: googleDisconnect ? { disconnect: googleDisconnect } : null
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
    '/api/privacy',
    createPrivacyRouter({
      privacyService,
      ...authentication,
      sensitiveLimiter: NO_LIMIT,
      mutationLimiter: NO_LIMIT,
      cookieName: COOKIE_NAME
    })
  );
  app.use('/api', apiNotFound);
  app.use(errorHandler({ logger: { error: () => {} }, isDevelopment: false }));

  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return { app, db, privacyService };
}

async function registrar(context, { name, email, password }) {
  const agent = request.agent(context.app);
  const response = await agent
    .post('/api/auth/register')
    .send({ name, email, password })
    .expect(201);
  return { agent, csrfToken: response.body.csrfToken, user: response.body.user };
}

test('matriz de retenção: políticas semeadas com base legal, prazo e ação de vencimento', async (t) => {
  const context = createContext(t);
  const { agent } = await registrar(context, {
    name: 'Admin',
    email: 'admin@privacidade.local',
    password: 'senha-admin'
  });

  await agent
    .get('/api/privacy/policies')
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.length, POLITICAS_DE_RETENCAO.length);
      for (const policy of body) {
        assert.ok(policy.legal_basis.includes('LGPD'));
        assert.ok(policy.retention_days > 0);
        assert.ok(['eliminar', 'anonimizar'].includes(policy.expiry_action));
      }
    });
});

test('exclusão da própria conta: nega senha errada e frase errada, elimina tudo, gera comprovante e barra o último administrador', async (t) => {
  const revogacoes = [];
  const context = createContext(t, {
    googleDisconnect: async (userId) => {
      revogacoes.push(userId);
    }
  });

  const admin = await registrar(context, {
    name: 'Admin',
    email: 'admin@privacidade.local',
    password: 'senha-admin'
  });

  // O único administrador ativo não pode se excluir.
  await admin.agent
    .post('/api/privacy/account/delete')
    .set('x-csrf-token', admin.csrfToken)
    .send({ password: 'senha-admin', confirmation: FRASE })
    .expect(409)
    .expect(({ body }) => assert.equal(body.error.code, 'ULTIMO_ADMINISTRADOR'));

  const pessoa = await registrar(context, {
    name: 'Pessoa Titular',
    email: 'titular@privacidade.local',
    password: 'senha-titular'
  });

  // Dados reais do titular antes da exclusão.
  const atividade = await pessoa.agent
    .post('/api/activities')
    .set('x-csrf-token', pessoa.csrfToken)
    .send({ title: 'Atividade da titular' })
    .expect(201);
  await pessoa.agent
    .post('/api/agenda')
    .set('x-csrf-token', pessoa.csrfToken)
    .send({
      title: 'Compromisso da titular',
      event_date: new Date().toISOString().slice(0, 10),
      start_time: '09:00',
      end_time: '10:00',
      activity_id: atividade.body.id
    })
    .expect(201);

  // Frase de confirmação incorreta → 422 sem excluir nada.
  await pessoa.agent
    .post('/api/privacy/account/delete')
    .set('x-csrf-token', pessoa.csrfToken)
    .send({ password: 'senha-titular', confirmation: 'excluir minha conta' })
    .expect(422);

  // Senha incorreta → 401 com auditoria de falha.
  await pessoa.agent
    .post('/api/privacy/account/delete')
    .set('x-csrf-token', pessoa.csrfToken)
    .send({ password: 'senha-errada', confirmation: FRASE })
    .expect(401)
    .expect(({ body }) => assert.equal(body.error.code, 'SENHA_ATUAL_INVALIDA'));

  const userId = pessoa.user.id;
  const deleted = await pessoa.agent
    .post('/api/privacy/account/delete')
    .set('x-csrf-token', pessoa.csrfToken)
    .send({ password: 'senha-titular', confirmation: FRASE })
    .expect(200);

  const receipt = deleted.body.receipt;
  assert.ok(receipt.receipt_uuid);
  assert.ok(receipt.integrity_hash);
  assert.ok(receipt.processed_tables.includes('users'));
  assert.ok(receipt.counts.activities >= 1);
  assert.ok(receipt.counts.agenda_events >= 1);
  assert.equal(receipt.counts.users, 1);
  assert.equal(receipt.legal_exceptions.length, 2);
  assert.equal(receipt.external_pending, null);

  // Acesso encerrado imediatamente: sessão antiga e novo login negados.
  await pessoa.agent.get('/api/auth/me').expect(401);
  await request(context.app)
    .post('/api/auth/login')
    .send({ email: 'titular@privacidade.local', password: 'senha-titular' })
    .expect(401);

  // Nenhum dado pessoal remanescente nas tabelas do titular.
  for (const tabela of ['users', 'activities', 'agenda_events', 'profile_data', 'auth_sessions']) {
    const total = Number(
      context.db.get(
        tabela === 'users'
          ? 'SELECT COUNT(*) AS total FROM users WHERE id = ?'
          : `SELECT COUNT(*) AS total FROM "${tabela}" WHERE user_id = ?`,
        [userId]
      ).total
    );
    assert.equal(total, 0, `restaram registros em ${tabela}`);
  }

  // Trilha de auditoria anonimizada: nenhum evento aponta para o id excluído.
  const eventosVinculados = Number(
    context.db.get(
      'SELECT COUNT(*) AS total FROM audit_events WHERE actor_user_id = ? OR target_user_id = ?',
      [userId, userId]
    ).total
  );
  assert.equal(eventosVinculados, 0);

  // Comprovante persistido e retenções registradas com bloqueio.
  const receiptRow = context.db.get('SELECT * FROM deletion_receipts WHERE receipt_uuid = ?', [
    receipt.receipt_uuid
  ]);
  assert.ok(receiptRow);
  const retencoes = context.db.all(
    'SELECT category, locked FROM legal_retention_records WHERE subject_hash = ?',
    [receiptRow.subject_hash]
  );
  assert.equal(retencoes.length, 2);
  assert.ok(retencoes.every((registro) => registro.locked === 1));

  // O administrador permanece intacto e a revogação Google não foi acionada
  // (a titular não tinha conexão Google).
  assert.equal(revogacoes.length, 0);
  await admin.agent
    .get('/api/auth/me')
    .expect(200)
    .expect(({ body }) => assert.equal(body.role, 'administrador'));
});

test('solicitações de titular: criação, listagem própria, fila administrativa e desfecho com resumo obrigatório', async (t) => {
  const context = createContext(t);
  const admin = await registrar(context, {
    name: 'Admin',
    email: 'admin@privacidade.local',
    password: 'senha-admin'
  });
  const pessoa = await registrar(context, {
    name: 'Pessoa',
    email: 'pessoa@privacidade.local',
    password: 'senha-pessoa'
  });

  await pessoa.agent
    .post('/api/privacy/requests')
    .set('x-csrf-token', pessoa.csrfToken)
    .send({ request_type: 'inexistente' })
    .expect(422);

  const criada = await pessoa.agent
    .post('/api/privacy/requests')
    .set('x-csrf-token', pessoa.csrfToken)
    .send({ request_type: 'acesso', details: 'Quero confirmar quais dados existem sobre mim.' })
    .expect(201);
  assert.equal(criada.body.status, 'aberta');
  assert.ok(criada.body.due_at);

  await pessoa.agent
    .get('/api/privacy/requests')
    .expect(200)
    .expect(({ body }) => assert.equal(body.length, 1));

  // Usuário comum não acessa a fila administrativa.
  await pessoa.agent.get('/api/privacy/admin/requests').expect(403);

  await admin.agent
    .get('/api/privacy/admin/requests')
    .expect(200)
    .expect(({ body }) => assert.equal(body.length, 1));

  // Desfecho sem resumo é negado; com resumo é registrado.
  await admin.agent
    .put(`/api/privacy/admin/requests/${criada.body.id}`)
    .set('x-csrf-token', admin.csrfToken)
    .send({ status: 'atendida' })
    .expect(422);

  await admin.agent
    .put(`/api/privacy/admin/requests/${criada.body.id}`)
    .set('x-csrf-token', admin.csrfToken)
    .send({ status: 'atendida', result_summary: 'Relatório de dados entregue ao titular.' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.status, 'atendida'));
});

test('vencimento da retenção: elimina ou anonimiza conforme a política', async (t) => {
  const context = createContext(t);
  const admin = await registrar(context, {
    name: 'Admin',
    email: 'admin@privacidade.local',
    password: 'senha-admin'
  });
  const segundoAdmin = await registrar(context, {
    name: 'Outra Pessoa',
    email: 'outra@privacidade.local',
    password: 'senha-outra'
  });

  // Excluir a segunda conta gera retenções reais.
  await segundoAdmin.agent
    .post('/api/privacy/account/delete')
    .set('x-csrf-token', segundoAdmin.csrfToken)
    .send({ password: 'senha-outra', confirmation: FRASE })
    .expect(200);

  // Força o vencimento imediato dos registros para exercitar a rotina real.
  context.db.run("UPDATE legal_retention_records SET retention_until = '2000-01-01T00:00:00Z'");

  await admin.agent
    .post('/api/privacy/admin/retention/enforce')
    .set('x-csrf-token', admin.csrfToken)
    .send({})
    .expect(200)
    .expect(({ body }) => assert.equal(body.processed, 2));

  // 'comprovante-de-exclusao' → eliminar; 'trilha-de-auditoria' → anonimizar.
  const restantes = context.db.all(
    'SELECT category, subject_hash, locked FROM legal_retention_records'
  );
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].category, 'trilha-de-auditoria');
  assert.equal(restantes[0].subject_hash, 'anonimizado');
  assert.equal(restantes[0].locked, 0);
});
