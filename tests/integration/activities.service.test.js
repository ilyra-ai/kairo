import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createCoreTables, openSqliteClient } from '../../src/server/database/index.js';
import { errorHandler } from '../../src/server/middleware/error-handler.js';
import { createActivitiesRouter } from '../../src/server/modules/activities/activities.routes.js';
import { createActivitiesService } from '../../src/server/modules/activities/activities.service.js';
import { forbidden } from '../../src/server/shared/http-error.js';

function createTestContext(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-activities-test-'));
  const databasePath = path.join(directory, 'database.sqlite');
  const db = openSqliteClient(databasePath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'usuario',
      plan TEXT NOT NULL DEFAULT 'free',
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.run(
    `INSERT INTO users (id, name, email, password_hash)
     VALUES (1, 'Pessoa Um', 'um@kairo.local', 'hash-de-teste')`
  );
  db.run(
    `INSERT INTO users (id, name, email, password_hash)
     VALUES (2, 'Pessoa Dois', 'dois@kairo.local', 'hash-de-teste')`
  );
  createCoreTables(db);

  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return { db, service: createActivitiesService(db) };
}

function expectHttpError(action, status, code) {
  assert.throws(action, (error) => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test('criação é atômica, inicializa três períodos e aplica unicidade por usuário', (t) => {
  const { db, service } = createTestContext(t);

  const first = service.create(1, { title: 'Planejamento profundo' });
  assert.deepEqual(first, {
    id: first.id,
    title: 'Planejamento profundo',
    timeframes: {
      daily: { current: 0, previous: 0 },
      weekly: { current: 0, previous: 0 },
      monthly: { current: 0, previous: 0 }
    },
    goals: {}
  });
  assert.equal(
    db.get(
      `SELECT COUNT(*) AS total
       FROM timeframes
       INNER JOIN activities ON activities.id = timeframes.activity_id
       WHERE activities.id = ? AND activities.user_id = ?`,
      [first.id, 1]
    ).total,
    3
  );

  expectHttpError(
    () => service.create(1, { title: 'Planejamento profundo' }),
    409,
    'ATIVIDADE_DUPLICADA'
  );

  const secondOwnerActivity = service.create(2, { title: 'Planejamento profundo' });
  assert.equal(secondOwnerActivity.title, first.title);
  assert.notEqual(secondOwnerActivity.id, first.id);
});

test('listagem usa três consultas constantes e nunca mistura dados entre usuários', (t) => {
  const { db, service } = createTestContext(t);
  const one = service.create(1, { title: 'Atividade um' });
  const two = service.create(1, { title: 'Atividade dois' });
  const privateToOtherUser = service.create(2, { title: 'Atividade privada' });
  service.updateGoal(1, one.id, { timeframe: 'weekly', target_hours: 12 });
  service.updateTimeframe(1, two.id, { timeframe: 'daily', current: 3.5, previous: 2 });

  const originalAll = db.all.bind(db);
  let allCalls = 0;
  db.all = (...parameters) => {
    allCalls += 1;
    return originalAll(...parameters);
  };
  const listed = service.list(1);
  db.all = originalAll;

  assert.equal(allCalls, 3);
  assert.deepEqual(listed.map((activity) => activity.id), [one.id, two.id]);
  assert.equal(listed[0].goals.weekly, 12);
  assert.deepEqual(listed[1].timeframes.daily, { current: 3.5, previous: 2 });
  assert.ok(!listed.some((activity) => activity.id === privateToOtherUser.id));

  expectHttpError(
    () => service.getDetails(2, one.id),
    404,
    'ATIVIDADE_NAO_ENCONTRADA'
  );
});

test('períodos e metas fazem upsert somente pela atividade pertencente ao usuário', (t) => {
  const { db, service } = createTestContext(t);
  const activity = service.create(1, { title: 'Execução segura' });

  db.run(
    `DELETE FROM timeframes
     WHERE activity_id = ? AND type = 'monthly'`,
    [activity.id]
  );
  assert.deepEqual(
    service.updateTimeframe(1, activity.id, {
      timeframe: 'monthly',
      current: 44.5,
      previous: 31
    }),
    { activity_id: activity.id, type: 'monthly', current: 44.5, previous: 31 }
  );
  assert.equal(
    db.get(
      `SELECT timeframes.current
       FROM timeframes
       INNER JOIN activities ON activities.id = timeframes.activity_id
       WHERE activities.id = ? AND activities.user_id = ? AND timeframes.type = 'monthly'`,
      [activity.id, 1]
    ).current,
    44.5
  );

  service.updateGoal(1, activity.id, { timeframe: 'weekly', target_hours: 10 });
  service.updateGoal(1, activity.id, { timeframe: 'weekly', target_hours: 18 });
  assert.equal(
    db.get(
      `SELECT goals.target_hours
       FROM goals
       INNER JOIN activities ON activities.id = goals.activity_id
       WHERE activities.id = ? AND activities.user_id = ? AND goals.type = 'weekly'`,
      [activity.id, 1]
    ).target_hours,
    18
  );

  expectHttpError(
    () => service.updateTimeframe(2, activity.id, {
      timeframe: 'daily',
      current: 99,
      previous: 99
    }),
    404,
    'ATIVIDADE_NAO_ENCONTRADA'
  );
  expectHttpError(
    () => service.updateGoal(2, activity.id, { timeframe: 'daily', target_hours: 99 }),
    404,
    'ATIVIDADE_NAO_ENCONTRADA'
  );
});

test('exclusão escopada contabiliza eventos e remove dependências por cascata real', (t) => {
  const { db, service } = createTestContext(t);
  const activity = service.create(1, { title: 'Categoria descartável' });
  const preserved = service.create(2, { title: 'Categoria preservada' });
  service.updateGoal(1, activity.id, { timeframe: 'daily', target_hours: 3 });
  db.run(
    `INSERT INTO agenda_events
       (user_id, activity_id, title, event_date, start_time, end_time, duration_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [1, activity.id, 'Evento dependente', '2026-07-16', '09:00', '10:00', 1]
  );

  expectHttpError(
    () => service.remove(2, activity.id),
    404,
    'ATIVIDADE_NAO_ENCONTRADA'
  );

  assert.deepEqual(service.remove(1, activity.id), {
    id: activity.id,
    title: 'Categoria descartável',
    deleted_events: 1
  });
  assert.equal(db.get('SELECT COUNT(*) AS total FROM activities WHERE id = ?', [activity.id]).total, 0);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM timeframes WHERE activity_id = ?', [activity.id]).total, 0);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM goals WHERE activity_id = ?', [activity.id]).total, 0);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM agenda_events WHERE activity_id = ?', [activity.id]).total, 0);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM activities WHERE id = ?', [preserved.id]).total, 1);
});

test('rotas validam entrada, exigem CSRF em mutações e reautenticação na exclusão', async (t) => {
  const { service } = createTestContext(t);
  const auditEvents = [];
  let csrfChecks = 0;
  let recentAuthChecks = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/activities', createActivitiesRouter({
    activitiesService: service,
    authService: { audit: (event) => auditEvents.push(event) },
    requireAuth: (req, _res, next) => {
      req.user = { id: Number(req.get('x-test-user') || 1) };
      req.authSession = { id: 'sessao-de-teste' };
      next();
    },
    requireCsrf: (req, _res, next) => {
      csrfChecks += 1;
      if (req.get('x-csrf-token') !== 'csrf-valido') {
        return next(forbidden('CSRF inválido.', 'CSRF_INVALIDO'));
      }
      next();
    },
    requireRecentAuth: (req, _res, next) => {
      recentAuthChecks += 1;
      if (req.get('x-recent-auth') !== 'confirmada') {
        return next(forbidden('Reautenticação necessária.', 'REAUTENTICACAO_NECESSARIA'));
      }
      next();
    },
    mutationLimiter: (_req, _res, next) => next()
  }));
  app.use(errorHandler({ logger: { error: () => {} } }));

  await request(app)
    .post('/api/activities')
    .send({ title: 'Sem token' })
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'CSRF_INVALIDO'));

  await request(app)
    .post('/api/activities')
    .set('x-csrf-token', 'csrf-valido')
    .send({ title: 'x' })
    .expect(422)
    .expect(({ body }) => assert.equal(body.error.code, 'VALIDACAO_FALHOU'));

  const created = await request(app)
    .post('/api/activities')
    .set('x-csrf-token', 'csrf-valido')
    .send({ title: 'Criada pela API' })
    .expect(201);
  assert.equal(created.body.title, 'Criada pela API');

  await request(app)
    .put(`/api/activities/${created.body.id}`)
    .send({ timeframe: 'daily', current: 1, previous: 0 })
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'CSRF_INVALIDO'));

  await request(app)
    .delete(`/api/activities/${created.body.id}`)
    .set('x-csrf-token', 'csrf-valido')
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'REAUTENTICACAO_NECESSARIA'));

  await request(app)
    .delete(`/api/activities/${created.body.id}`)
    .set('x-csrf-token', 'csrf-valido')
    .set('x-recent-auth', 'confirmada')
    .expect(200)
    .expect(({ body }) => assert.equal(body.deleted_events, 0));

  assert.equal(auditEvents.filter((event) => event.action === 'activities.create').length, 1);
  assert.equal(auditEvents.filter((event) => event.action === 'activities.delete').length, 1);
  assert.equal(recentAuthChecks, 2);
  assert.ok(csrfChecks >= 5);
});
