import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { createCoreTables, openSqliteClient } from '../../src/server/database/index.js';
import { createAuthenticationMiddleware } from '../../src/server/middleware/authentication.js';
import {
  apiNotFound,
  errorHandler,
  requestIdMiddleware
} from '../../src/server/middleware/error-handler.js';
import { createAgendaRouter } from '../../src/server/modules/agenda/agenda.routes.js';
import {
  AGENDA_DESCRIPTION_MAX_LENGTH,
  AGENDA_TITLE_MAX_LENGTH,
  createAgendaEventSchema,
  updateAgendaEventSchema
} from '../../src/server/modules/agenda/agenda.schemas.js';
import { createAgendaService } from '../../src/server/modules/agenda/agenda.service.js';
import { unauthorized } from '../../src/server/shared/http-error.js';

const FIXED_NOW = new Date('2026-07-16T15:00:00.000Z');

function createTestContext(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-agenda-test-'));
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
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

  const activityOne = db.run('INSERT INTO activities (user_id, title) VALUES (?, ?)', [
    1,
    'Trabalho da pessoa um'
  ]).lastID;
  const activityOneAlternative = db.run('INSERT INTO activities (user_id, title) VALUES (?, ?)', [
    1,
    'Estudo da pessoa um'
  ]).lastID;
  const activityTwo = db.run('INSERT INTO activities (user_id, title) VALUES (?, ?)', [
    2,
    'Trabalho da pessoa dois'
  ]).lastID;

  const agendaService = createAgendaService({
    db,
    now: () => new Date(FIXED_NOW),
    timeZone: 'America/Sao_Paulo'
  });

  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return {
    activityOne,
    activityOneAlternative,
    activityTwo,
    agendaService,
    db
  };
}

function validEvent(activityId, overrides = {}) {
  return {
    activity_id: activityId,
    title: 'Planejamento estratégico',
    description: 'Revisar prioridades e próximos passos.',
    event_date: '2026-07-16',
    start_time: '09:00',
    end_time: '10:00',
    priority: 'media',
    cognitive_load: 2,
    event_color: '#7c6fff',
    ...overrides
  };
}

function assertHttpError(operation, status, code) {
  assert.throws(operation, (error) => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

function timeframe(db, activityId, type) {
  return db.get(
    `SELECT timeframes.current, timeframes.previous
     FROM timeframes
     WHERE timeframes.activity_id = ? AND timeframes.type = ?`,
    [activityId, type]
  );
}

function assertHours(actual, expected, message) {
  assert.ok(
    Math.abs(Number(actual) - expected) < 1e-12,
    `${message}: esperado ${expected}, recebido ${actual}`
  );
}

test('1. contratos rejeitam datas, horas, limites, enums, cores e campos indevidos', (t) => {
  const { activityOne } = createTestContext(t);
  const invalidInputs = [
    validEvent(activityOne, { event_date: '2026-02-29' }),
    validEvent(activityOne, { event_date: '16/07/2026' }),
    validEvent(activityOne, { start_time: '24:00' }),
    validEvent(activityOne, { start_time: '9:00' }),
    validEvent(activityOne, { start_time: '10:00', end_time: '10:00' }),
    validEvent(activityOne, { start_time: '10:01', end_time: '10:00' }),
    validEvent(activityOne, { title: 'x'.repeat(AGENDA_TITLE_MAX_LENGTH + 1) }),
    validEvent(activityOne, { description: 'x'.repeat(AGENDA_DESCRIPTION_MAX_LENGTH + 1) }),
    validEvent(activityOne, { priority: 'urgente' }),
    validEvent(activityOne, { cognitive_load: 0 }),
    validEvent(activityOne, { cognitive_load: 4 }),
    validEvent(activityOne, { event_color: 'red' }),
    validEvent(activityOne, { event_color: '#fff' }),
    validEvent(activityOne, { event_color: '#7c6fff; background:url(javascript:alert(1))' }),
    { ...validEvent(activityOne), user_id: 2 }
  ];

  for (const [index, input] of invalidInputs.entries()) {
    assert.equal(
      createAgendaEventSchema.safeParse(input).success,
      false,
      `A entrada inválida ${index + 1} não poderia ser aceita.`
    );
  }

  assert.equal(
    updateAgendaEventSchema.safeParse({ is_completed: true }).success,
    false,
    'A edição integral não pode ser usada como atalho de conclusão.'
  );
  assert.equal(
    updateAgendaEventSchema.safeParse({ ...validEvent(activityOne), is_completed: true }).success,
    false,
    'O status pertence exclusivamente ao contrato de conclusão rápida.'
  );

  const leapDate = createAgendaEventSchema.safeParse(
    validEvent(activityOne, { event_date: '2028-02-29', event_color: null })
  );
  assert.equal(leapDate.success, true);
});

test('2. criação persiste minutos exatos, normaliza texto e associa somente ao proprietário', (t) => {
  const { activityOne, agendaService, db } = createTestContext(t);
  const event = agendaService.create(
    1,
    validEvent(activityOne, {
      title: '  Revisão de 61 minutos  ',
      description: '  Conteúdo preservado sem HTML gerado pela API.  ',
      start_time: '09:00',
      end_time: '10:01',
      event_color: '#Aa00Ff'
    })
  );

  assert.equal(event.title, 'Revisão de 61 minutos');
  assert.equal(event.description, 'Conteúdo preservado sem HTML gerado pela API.');
  assert.equal(event.event_color, '#aa00ff');
  assert.equal(event.is_completed, false);
  assertHours(event.duration_hours, 61 / 60, 'A duração do compromisso perdeu precisão');

  const persisted = db.get(
    `SELECT agenda_events.user_id, agenda_events.activity_id, agenda_events.duration_hours
     FROM agenda_events
     WHERE agenda_events.id = ?`,
    [event.id]
  );
  assert.deepEqual(
    { user_id: persisted.user_id, activity_id: persisted.activity_id },
    { user_id: 1, activity_id: activityOne }
  );
  assertHours(persisted.duration_hours, 61 / 60, 'A duração persistida perdeu precisão');
  assertHours(
    timeframe(db, activityOne, 'daily').current,
    61 / 60,
    'O período diário foi arredondado'
  );
});

test('3. CRUD completo devolve 404 em qualquer tentativa de acesso entre usuários', (t) => {
  const { activityOne, activityTwo, agendaService, db } = createTestContext(t);
  const eventOne = agendaService.create(
    1,
    validEvent(activityOne, { title: 'Privado da pessoa um' })
  );
  const eventTwo = agendaService.create(
    2,
    validEvent(activityTwo, { title: 'Privado da pessoa dois' })
  );

  assert.deepEqual(
    agendaService.list(1).map((event) => event.id),
    [eventOne.id]
  );
  assert.deepEqual(
    agendaService.list(2).map((event) => event.id),
    [eventTwo.id]
  );
  assert.deepEqual(
    agendaService.listByActivity(1, activityOne).map((event) => event.id),
    [eventOne.id]
  );

  assertHttpError(() => agendaService.get(1, eventTwo.id), 404, 'COMPROMISSO_NAO_ENCONTRADO');
  assertHttpError(
    () => agendaService.listByActivity(1, activityTwo),
    404,
    'ATIVIDADE_NAO_ENCONTRADA'
  );
  assertHttpError(
    () => agendaService.create(1, validEvent(activityTwo)),
    404,
    'ATIVIDADE_NAO_ENCONTRADA'
  );
  assertHttpError(
    () => agendaService.update(1, eventTwo.id, validEvent(activityOne)),
    404,
    'COMPROMISSO_NAO_ENCONTRADO'
  );
  assertHttpError(
    () => agendaService.updateCompletion(1, eventTwo.id, { is_completed: true }),
    404,
    'COMPROMISSO_NAO_ENCONTRADO'
  );
  assertHttpError(() => agendaService.remove(1, eventTwo.id), 404, 'COMPROMISSO_NAO_ENCONTRADO');

  assert.equal(
    db.get('SELECT title FROM agenda_events WHERE id = ?', [eventTwo.id]).title,
    'Privado da pessoa dois'
  );
  assert.equal(
    db.get('SELECT is_completed FROM agenda_events WHERE id = ?', [eventTwo.id]).is_completed,
    0
  );
});

test('4. recálculo preserva minutos e previous, limita-se às atividades afetadas e é atômico', (t) => {
  const { activityOne, activityOneAlternative, activityTwo, agendaService, db } =
    createTestContext(t);

  db.run(
    `INSERT INTO timeframes (activity_id, type, current, previous)
     VALUES (?, 'daily', 0, 9)`,
    [activityOne]
  );
  db.run(
    `INSERT INTO timeframes (activity_id, type, current, previous)
     VALUES (?, 'daily', 77, 66)`,
    [activityTwo]
  );

  const today = agendaService.create(
    1,
    validEvent(activityOne, {
      title: 'Hoje, 61 minutos',
      start_time: '09:00',
      end_time: '10:01'
    })
  );
  agendaService.create(
    1,
    validEvent(activityOne, {
      title: 'Nesta semana, 60 minutos',
      event_date: '2026-07-13',
      start_time: '11:00',
      end_time: '12:00'
    })
  );
  agendaService.create(
    1,
    validEvent(activityOne, {
      title: 'Neste mês, 30 minutos',
      event_date: '2026-07-20',
      start_time: '14:00',
      end_time: '14:30'
    })
  );

  assertHours(timeframe(db, activityOne, 'daily').current, 61 / 60, 'Total diário incorreto');
  assertHours(timeframe(db, activityOne, 'weekly').current, 121 / 60, 'Total semanal incorreto');
  assertHours(timeframe(db, activityOne, 'monthly').current, 151 / 60, 'Total mensal incorreto');
  assert.equal(timeframe(db, activityOne, 'daily').previous, 9);
  assert.deepEqual(timeframe(db, activityTwo, 'daily'), { current: 77, previous: 66 });

  const completed = agendaService.updateCompletion(1, today.id, { is_completed: true });
  assert.equal(completed.is_completed, true);
  const moved = agendaService.update(
    1,
    today.id,
    validEvent(activityOneAlternative, {
      title: 'Movido com 62 minutos',
      start_time: '11:00',
      end_time: '12:02',
      event_color: null
    })
  );
  assert.equal(moved.activity_id, activityOneAlternative);
  assert.equal(
    moved.is_completed,
    true,
    'A edição integral não deve reabrir um compromisso concluído.'
  );
  assertHours(moved.duration_hours, 62 / 60, 'A edição perdeu a precisão por minuto');

  assertHours(
    timeframe(db, activityOne, 'daily').current,
    0,
    'A atividade de origem não foi recalculada'
  );
  assertHours(
    timeframe(db, activityOne, 'weekly').current,
    1,
    'A semana da atividade de origem ficou incorreta'
  );
  assertHours(
    timeframe(db, activityOne, 'monthly').current,
    1.5,
    'O mês da atividade de origem ficou incorreto'
  );
  assertHours(
    timeframe(db, activityOneAlternative, 'daily').current,
    62 / 60,
    'A atividade de destino ficou incorreta'
  );
  assert.deepEqual(timeframe(db, activityTwo, 'daily'), { current: 77, previous: 66 });

  agendaService.remove(1, moved.id);
  assertHours(
    timeframe(db, activityOneAlternative, 'daily').current,
    0,
    'A exclusão não zerou o período diário'
  );
  assert.equal(
    db.get('SELECT COUNT(*) AS total FROM agenda_events WHERE id = ?', [moved.id]).total,
    0
  );

  db.exec(`
    CREATE TRIGGER impedir_atualizacao_de_timeframe
    BEFORE UPDATE ON timeframes
    WHEN NEW.activity_id = ${activityOne}
    BEGIN
      SELECT RAISE(ABORT, 'falha deliberada no recálculo');
    END;
  `);
  assert.throws(
    () => agendaService.create(1, validEvent(activityOne, { title: 'Não deve persistir' })),
    /falha deliberada no recálculo/
  );
  assert.equal(
    db.get("SELECT COUNT(*) AS total FROM agenda_events WHERE title = 'Não deve persistir'").total,
    0,
    'A criação do evento deveria ser revertida junto com o recálculo.'
  );
});

test('5. conclusão rápida altera apenas o status e filtros não vazam eventos', (t) => {
  const { activityOne, agendaService, db } = createTestContext(t);
  const event = agendaService.create(
    1,
    validEvent(activityOne, {
      start_time: '08:17',
      end_time: '09:43'
    })
  );
  const before = db.get('SELECT * FROM agenda_events WHERE id = ?', [event.id]);
  const totalsBefore = db.all(
    'SELECT type, current, previous FROM timeframes WHERE activity_id = ? ORDER BY type',
    [activityOne]
  );

  const completed = agendaService.updateCompletion(1, event.id, { is_completed: true });
  assert.equal(completed.is_completed, true);
  const after = db.get('SELECT * FROM agenda_events WHERE id = ?', [event.id]);
  assert.deepEqual(
    { ...after, is_completed: before.is_completed },
    before,
    'A conclusão rápida alterou campos além de is_completed.'
  );
  assert.deepEqual(
    db.all('SELECT type, current, previous FROM timeframes WHERE activity_id = ? ORDER BY type', [
      activityOne
    ]),
    totalsBefore,
    'A conclusão rápida recalculou períodos sem necessidade.'
  );

  assert.deepEqual(
    agendaService.list(1, { is_completed: true }).map((item) => item.id),
    [event.id]
  );
  assert.deepEqual(agendaService.list(1, { is_completed: false }), []);
  assert.deepEqual(agendaService.list(1, { from: '2026-07-17', to: '2026-07-31' }), []);
  assertHttpError(
    () => agendaService.update(1, event.id, { is_completed: false }),
    422,
    'AGENDA_VALIDACAO_FALHOU'
  );
});

test('6. rotas exigem sessão e CSRF nas mutações, além de autenticação recente na exclusão', async (t) => {
  const { activityOne, activityTwo, agendaService } = createTestContext(t);
  const foreignEvent = agendaService.create(
    2,
    validEvent(activityTwo, { title: 'Evento de outra pessoa' })
  );

  const middlewareAuthService = {
    authenticate(token) {
      if (!['sessao-normal', 'sessao-recente'].includes(token)) {
        throw unauthorized('Autenticação necessária.', 'NAO_AUTENTICADO');
      }
      return {
        user: { id: 1, role: 'usuario', plan: 'free' },
        session: {
          id: token,
          reauthenticatedAt: token === 'sessao-recente' ? new Date().toISOString() : null
        }
      };
    },
    verifyCsrf(_sessionId, token) {
      return token === 'csrf-valido';
    },
    hasRecentAuthentication(session) {
      return Boolean(session?.reauthenticatedAt);
    }
  };
  const authentication = createAuthenticationMiddleware({
    authService: middlewareAuthService,
    cookieName: 'kairo.session'
  });
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    createAgendaRouter({
      agendaService,
      requireAuth: authentication.requireAuth,
      requireCsrf: authentication.requireCsrf,
      requireRecentAuth: authentication.requireRecentAuth,
      mutationLimiter: (_req, _res, next) => next()
    })
  );
  app.use(apiNotFound);
  app.use(errorHandler({ logger: { error() {} }, isDevelopment: false }));

  await request(app)
    .get('/agenda')
    .expect(401)
    .expect(({ body }) => assert.equal(body.error.code, 'NAO_AUTENTICADO'));

  await request(app)
    .post('/agenda')
    .set('Cookie', 'kairo.session=sessao-normal')
    .send(validEvent(activityOne))
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'CSRF_INVALIDO'));

  const createdResponse = await request(app)
    .post('/agenda')
    .set('Cookie', 'kairo.session=sessao-normal')
    .set('x-csrf-token', 'csrf-valido')
    .send(validEvent(activityOne, { title: 'Criado pela rota segura' }))
    .expect(201);
  const eventId = createdResponse.body.event.id;

  await request(app)
    .put(`/agenda/${eventId}`)
    .set('Cookie', 'kairo.session=sessao-normal')
    .set('x-csrf-token', 'csrf-valido')
    .send({ is_completed: true })
    .expect(422)
    .expect(({ body }) => assert.equal(body.error.code, 'VALIDACAO_FALHOU'));

  await request(app)
    .patch(`/agenda/${eventId}/completion`)
    .set('Cookie', 'kairo.session=sessao-normal')
    .set('x-csrf-token', 'csrf-valido')
    .send({ is_completed: true })
    .expect(200)
    .expect(({ body }) => assert.equal(body.event.is_completed, true));

  await request(app)
    .get(`/agenda/${foreignEvent.id}`)
    .set('Cookie', 'kairo.session=sessao-normal')
    .expect(404)
    .expect(({ body }) => assert.equal(body.error.code, 'COMPROMISSO_NAO_ENCONTRADO'));

  await request(app)
    .delete(`/agenda/${eventId}`)
    .set('Cookie', 'kairo.session=sessao-normal')
    .set('x-csrf-token', 'csrf-valido')
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'REAUTENTICACAO_NECESSARIA'));

  await request(app)
    .delete(`/agenda/${eventId}`)
    .set('Cookie', 'kairo.session=sessao-recente')
    .set('x-csrf-token', 'csrf-valido')
    .expect(204);

  assertHttpError(() => agendaService.get(1, eventId), 404, 'COMPROMISSO_NAO_ENCONTRADO');
});
