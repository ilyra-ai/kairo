import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createCoreTables, openSqliteClient } from '../../src/server/database/index.js';
import { errorHandler } from '../../src/server/middleware/error-handler.js';
import { createRewardsRouter } from '../../src/server/modules/rewards/rewards.routes.js';
import {
  createRewardsService,
  ensureRewardsSchema,
  REWARDS_SCHEMA_MIGRATION
} from '../../src/server/modules/rewards/rewards.service.js';
import { forbidden } from '../../src/server/shared/http-error.js';

const FIXED_NOW = new Date('2026-07-16T12:00:00.000Z');
let activitySequence = 0;

function createUsersTable(db) {
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
    `INSERT INTO users (id, name, email, password_hash, role, plan)
     VALUES (1, 'Pessoa Um', 'um@kairo.local', 'hash', 'administrador', 'pro')`
  );
  db.run(
    `INSERT INTO users (id, name, email, password_hash, role, plan)
     VALUES (2, 'Pessoa Dois', 'dois@kairo.local', 'hash', 'usuario', 'free')`
  );
}

function createContext(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-rewards-test-'));
  const databasePath = path.join(directory, 'database.sqlite');
  const db = openSqliteClient(databasePath);
  createUsersTable(db);
  createCoreTables(db);
  if (options.ensureSchema !== false) ensureRewardsSchema(db);

  const service =
    options.ensureSchema === false
      ? null
      : createRewardsService({
          db,
          randomInt: options.randomInt ?? ((maximum) => maximum - 1),
          now: options.now ?? (() => new Date(FIXED_NOW))
        });

  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, service };
}

function createAgendaEvent(db, userId, options = {}) {
  const activity = db.run('INSERT INTO activities (user_id, title) VALUES (?, ?)', [
    userId,
    options.activityTitle ?? `Atividade ${userId}-${++activitySequence}`
  ]);
  const event = db.run(
    `INSERT INTO agenda_events (
      user_id, activity_id, title, event_date, start_time, end_time,
      duration_hours, is_completed, cognitive_load
    ) VALUES (?, ?, ?, '2026-07-16', '09:00', '10:00', 1, ?, ?)`,
    [
      userId,
      activity.lastID,
      options.title ?? 'Compromisso de teste',
      options.completed === false ? 0 : 1,
      options.cognitiveLoad ?? 1
    ]
  );
  return { activityId: Number(activity.lastID), eventId: Number(event.lastID) };
}

function expectHttpError(action, status, code) {
  assert.throws(action, (error) => {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test('migração transacional preserva legado válido e cria FKs, checks, índices e gatilhos de proprietário', (t) => {
  const { db } = createContext(t, { ensureSchema: false });
  db.exec(`
    CREATE TABLE user_gamification (
      user_id INTEGER PRIMARY KEY,
      coins INTEGER DEFAULT 0,
      current_streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      today_date TEXT,
      today_count INTEGER DEFAULT 0,
      best_day_count INTEGER DEFAULT 0,
      total_completions INTEGER DEFAULT 0,
      combo INTEGER DEFAULT 0,
      collectibles TEXT DEFAULT '[]',
      last_completion_at DATETIME,
      updated_at DATETIME
    );
    INSERT INTO user_gamification
      (user_id, coins, current_streak, longest_streak, today_count, best_day_count, collectibles)
    VALUES (1, 25, 3, 3, 2, 2, '[{"item":"Legado"}]');
    INSERT INTO user_gamification (user_id, coins) VALUES (999, 999999);

    CREATE TABLE dopamenu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT,
      label TEXT NOT NULL
    );
    INSERT INTO dopamenu (id, user_id, category, label)
      VALUES (7, 1, 'principal', 'Tomar um café especial');

    CREATE TABLE dopamine_config (feature_key TEXT PRIMARY KEY, enabled INTEGER);
    INSERT INTO dopamine_config VALUES ('combo', 0);
    INSERT INTO dopamine_config VALUES ('chave_desconhecida', 1);

    CREATE TABLE ai_reward_config (key TEXT PRIMARY KEY, value INTEGER);
    INSERT INTO ai_reward_config VALUES ('nao_repetir', 1);

    CREATE TABLE reward_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tier TEXT NOT NULL,
      generator TEXT,
      coins INTEGER,
      chest INTEGER,
      collectible TEXT,
      jackpot INTEGER,
      context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO reward_events
      (id, user_id, tier, generator, coins, chest, jackpot, context)
    VALUES (11, 1, 'normal', 'recompensa_variavel', 10, 0, 0, 'atividade');

    CREATE TABLE reward_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      reward_event_id INTEGER NOT NULL,
      generator TEXT,
      rating INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO reward_feedback
      (id, user_id, reward_event_id, generator, rating)
    VALUES (13, 1, 11, 'recompensa_variavel', 5);
  `);

  assert.deepEqual(ensureRewardsSchema(db), { migrated: true, created: false });
  assert.equal(db.get('SELECT coins FROM user_gamification WHERE user_id = 1').coins, 25);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM user_gamification').total, 1);
  assert.equal(db.get('SELECT label FROM dopamenu WHERE id = 7').label, 'Tomar um café especial');
  assert.equal(
    db.get("SELECT enabled FROM dopamine_config WHERE feature_key = 'combo'").enabled,
    0
  );
  assert.equal(
    db.get("SELECT COUNT(*) AS total FROM dopamine_config WHERE feature_key = 'chave_desconhecida'")
      .total,
    0
  );
  assert.equal(db.get("SELECT value FROM ai_reward_config WHERE key = 'nao_repetir'").value, 1);
  assert.equal(
    db.get('SELECT agenda_event_id FROM reward_events WHERE id = 11').agenda_event_id,
    null
  );
  assert.equal(db.get('SELECT rating FROM reward_feedback WHERE id = 13').rating, 5);
  assert.equal(
    db.get('SELECT COUNT(*) AS total FROM schema_migrations WHERE name = ?', [
      REWARDS_SCHEMA_MIGRATION
    ]).total,
    1
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);

  for (const tableName of [
    'user_gamification',
    'dopamenu',
    'dopamine_config',
    'ai_reward_config',
    'reward_events',
    'reward_feedback'
  ]) {
    assert.equal(
      db.get("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = ?", [
        `${tableName}_legacy_rewards`
      ]).total,
      0
    );
  }

  const otherUserEvent = createAgendaEvent(db, 2, { activityTitle: 'Privada do usuário dois' });
  assert.throws(
    () =>
      db.run(
        `INSERT INTO reward_events
        (user_id, agenda_event_id, tier, generator, coins)
       VALUES (1, ?, 'normal', 'recompensa_variavel', 10)`,
        [otherUserEvent.eventId]
      ),
    /REWARD_EVENT_OWNER_MISMATCH/
  );

  const indexNames = new Set(
    db.all("SELECT name FROM sqlite_master WHERE type = 'index'").map((row) => row.name)
  );
  assert.ok(indexNames.has('idx_reward_events_user_agenda_unique'));
  assert.ok(indexNames.has('idx_reward_events_generator_date'));
  assert.deepEqual(ensureRewardsSchema(db), { migrated: false, created: false });
});

test('falha estrutural durante a migração reverte integralmente o legado e restaura as FKs', (t) => {
  const { db } = createContext(t, { ensureSchema: false });
  db.exec(`
    CREATE TABLE reward_events (
      user_id INTEGER NOT NULL,
      tier TEXT NOT NULL
    );
    INSERT INTO reward_events (user_id, tier) VALUES (1, 'normal');
  `);

  assert.throws(() => ensureRewardsSchema(db), /no such column: r\.id/);
  assert.deepEqual(db.all('SELECT user_id, tier FROM reward_events'), [
    { user_id: 1, tier: 'normal' }
  ]);
  assert.equal(
    db.get(
      "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'reward_events_legacy_rewards'"
    ).total,
    0
  );
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('conclusão exige compromisso próprio concluído, é idempotente e não duplica moedas', (t) => {
  const { db, service } = createContext(t);
  const own = createAgendaEvent(db, 1, { activityTitle: 'Compromisso próprio concluído' });
  const incomplete = createAgendaEvent(db, 1, {
    activityTitle: 'Compromisso ainda aberto',
    completed: false
  });
  const privateToOtherUser = createAgendaEvent(db, 2, {
    activityTitle: 'Compromisso privado de outro usuário'
  });

  const first = service.registerCompletion(1, { agenda_event_id: own.eventId });
  assert.equal(first.agenda_event_id, own.eventId);
  assert.equal(first.idempotent, false);
  assert.equal(first.tier, 'bau');
  assert.equal(first.coins, 20);
  assert.equal(first.coins_total, 20);
  assert.equal(first.chest, true);

  const repeated = service.registerCompletion(1, { agenda_event_id: own.eventId });
  assert.equal(repeated.event_id, first.event_id);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.coins_total, 20);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM reward_events WHERE user_id = 1').total, 1);
  assert.equal(db.get('SELECT coins FROM user_gamification WHERE user_id = 1').coins, 20);

  expectHttpError(
    () => service.registerCompletion(1, { agenda_event_id: incomplete.eventId }),
    409,
    'COMPROMISSO_NAO_CONCLUIDO'
  );
  expectHttpError(
    () => service.registerCompletion(1, { agenda_event_id: privateToOtherUser.eventId }),
    404,
    'COMPROMISSO_NAO_ENCONTRADO'
  );

  const otherReward = service.registerCompletion(2, {
    agenda_event_id: privateToOtherUser.eventId
  });
  assert.equal(otherReward.coins_total, 20);
  assert.equal(service.getState(1).coins, 20);
  assert.equal(service.getState(2).coins, 20);

  const secondOwn = createAgendaEvent(db, 1, { activityTitle: 'Segundo compromisso próprio' });
  db.run(
    "UPDATE user_gamification SET last_completion_at = '2026-07-16 12:00:00' WHERE user_id = 1"
  );
  const comboReward = service.registerCompletion(1, { agenda_event_id: secondOwn.eventId });
  assert.equal(comboReward.combo, 2);
  assert.equal(comboReward.coins, 40);
  assert.equal(comboReward.coins_total, 60);
});

test('avaliação e Dopamenu são únicos, validados e estritamente isolados por usuário', (t) => {
  const { db, service } = createContext(t);
  const own = createAgendaEvent(db, 1, { activityTitle: 'Evento para avaliação' });
  const reward = service.registerCompletion(1, { agenda_event_id: own.eventId });

  assert.deepEqual(service.submitFeedback(1, { event_id: reward.event_id, rating: 5 }), {
    id: 1,
    event_id: reward.event_id,
    rating: 5
  });
  expectHttpError(
    () => service.submitFeedback(1, { event_id: reward.event_id, rating: 4 }),
    409,
    'AVALIACAO_JA_ENVIADA'
  );
  expectHttpError(
    () => service.submitFeedback(2, { event_id: reward.event_id, rating: 5 }),
    404,
    'RECOMPENSA_NAO_ENCONTRADA'
  );
  expectHttpError(
    () => service.submitFeedback(1, { event_id: reward.event_id, rating: 8 }),
    422,
    'AVALIACAO_VALIDACAO_FALHOU'
  );

  assert.equal(service.getDopamenu(1).length, 6);
  const custom = service.addDopamenuItem(1, {
    category: 'sobremesa',
    label: 'Ler um capítulo de ficção'
  });
  assert.equal(custom.label, 'Ler um capítulo de ficção');
  expectHttpError(
    () =>
      service.addDopamenuItem(1, {
        category: 'sobremesa',
        label: 'Ler um capítulo de ficção'
      }),
    409,
    'DOPAMENU_ITEM_DUPLICADO'
  );
  expectHttpError(
    () =>
      service.updateDopamenuItem(2, custom.id, {
        category: 'principal',
        label: 'Tentativa indevida'
      }),
    404,
    'DOPAMENU_ITEM_NAO_ENCONTRADO'
  );
  assert.deepEqual(
    service.updateDopamenuItem(1, custom.id, {
      category: 'principal',
      label: 'Ler dois capítulos de ficção'
    }),
    {
      id: custom.id,
      category: 'principal',
      label: 'Ler dois capítulos de ficção'
    }
  );
  expectHttpError(
    () => service.deleteDopamenuItem(2, custom.id),
    404,
    'DOPAMENU_ITEM_NAO_ENCONTRADO'
  );
  assert.equal(service.deleteDopamenuItem(1, custom.id).id, custom.id);
  expectHttpError(
    () => service.deleteDopamenuItem(1, custom.id),
    404,
    'DOPAMENU_ITEM_NAO_ENCONTRADO'
  );
});

test('configuração administrativa e dashboard usam dados reais agregados sem expor memória privada', (t) => {
  const { db, service } = createContext(t);
  const firstEvent = createAgendaEvent(db, 1, { activityTitle: 'Métrica do administrador' });
  const secondEvent = createAgendaEvent(db, 2, { activityTitle: 'Métrica do usuário' });
  const firstReward = service.registerCompletion(1, { agenda_event_id: firstEvent.eventId });
  service.registerCompletion(2, { agenda_event_id: secondEvent.eventId });
  service.submitFeedback(1, { event_id: firstReward.event_id, rating: 4 });

  assert.deepEqual(service.setGeneratorEnabled({ key: 'surpresa', enabled: false }), {
    key: 'surpresa',
    enabled: false
  });
  assert.deepEqual(service.setAiFlag({ key: 'nao_repetir', value: true }), {
    key: 'nao_repetir',
    value: true
  });
  const config = service.getConfig();
  assert.equal(config.generators.surpresa.enabled, false);
  assert.equal(config.ai.nao_repetir, true);
  expectHttpError(
    () => service.setGeneratorEnabled({ key: 'inexistente', enabled: true }),
    422,
    'GERADOR_VALIDACAO_FALHOU'
  );

  db.exec(`
    CREATE TABLE ai_private_memory (
      user_id INTEGER PRIMARY KEY,
      encrypted_payload TEXT NOT NULL
    );
  `);
  db.run('INSERT INTO ai_private_memory (user_id, encrypted_payload) VALUES (?, ?)', [
    1,
    'SEGREDO_QUE_NAO_PODE_SAIR'
  ]);

  const dashboard = service.getExecutiveDashboard();
  assert.equal(dashboard.totais.total_recompensas, 2);
  assert.equal(dashboard.totais.total_moedas, 40);
  assert.equal(dashboard.totais.satisfacao_geral, 4);
  assert.equal(dashboard.metricas.retencao.total, 2);
  assert.equal(JSON.stringify(dashboard).includes('SEGREDO_QUE_NAO_PODE_SAIR'), false);
});

test('rotas exigem CSRF nas mutações e reautenticação recente na administração', async (t) => {
  const { db, service } = createContext(t);
  const own = createAgendaEvent(db, 1, { activityTitle: 'Evento pelas rotas' });
  const audits = [];
  let recentAuthChecks = 0;
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createRewardsRouter({
      rewardsService: service,
      authService: { audit: (event) => audits.push(event) },
      requireAuth: (req, _res, next) => {
        req.user = {
          id: Number(req.get('x-test-user') || 1),
          role: req.get('x-test-role') || 'usuario'
        };
        next();
      },
      requireAdmin: (req, _res, next) => {
        if (req.user.role !== 'administrador') {
          return next(forbidden('Acesso administrativo necessário.', 'ADMIN_NECESSARIO'));
        }
        next();
      },
      requireCsrf: (req, _res, next) => {
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
    })
  );
  app.use(errorHandler({ logger: { error: () => {} } }));

  await request(app)
    .post('/api/rewards/complete')
    .send({ agenda_event_id: own.eventId })
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'CSRF_INVALIDO'));

  await request(app)
    .post('/api/rewards/complete')
    .set('x-csrf-token', 'csrf-valido')
    .send({ agenda_event_id: 'inválido' })
    .expect(422)
    .expect(({ body }) => assert.equal(body.error.code, 'VALIDACAO_FALHOU'));

  const completed = await request(app)
    .post('/api/rewards/complete')
    .set('x-csrf-token', 'csrf-valido')
    .send({ agenda_event_id: own.eventId })
    .expect(200);
  assert.equal(completed.body.agenda_event_id, own.eventId);

  const menu = await request(app).get('/api/dopamenu').expect(200);
  const menuItemId = menu.body[0].id;
  await request(app)
    .put(`/api/dopamenu/${menuItemId}`)
    .send({ category: 'entrada', label: 'Atualização sem CSRF' })
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'CSRF_INVALIDO'));
  await request(app)
    .put(`/api/dopamenu/${menuItemId}`)
    .set('x-csrf-token', 'csrf-valido')
    .send({ category: 'entrada', label: 'Alongar com respiração consciente' })
    .expect(200)
    .expect(({ body }) => assert.equal(body.label, 'Alongar com respiração consciente'));

  await request(app)
    .get('/api/rewards/config')
    .expect(403)
    .expect(({ body }) => assert.equal(body.error.code, 'ADMIN_NECESSARIO'));

  // Política vigente: configuração administrativa exige papel e CSRF, não a senha.
  await request(app)
    .post('/api/rewards/config')
    .set('x-test-role', 'administrador')
    .set('x-csrf-token', 'csrf-valido')
    .send({ key: 'combo', enabled: false })
    .expect(200)
    .expect(({ body }) => assert.equal(body.enabled, false));

  await request(app)
    .delete('/api/dopamenu/999999')
    .set('x-csrf-token', 'csrf-valido')
    .expect(404)
    .expect(({ body }) => assert.equal(body.error.code, 'DOPAMENU_ITEM_NAO_ENCONTRADO'));

  // Nenhuma rota de recompensas exige reautenticação na política vigente.
  assert.equal(recentAuthChecks, 0);
  assert.equal(audits.filter((event) => event.action === 'rewards.complete').length, 1);
  assert.equal(audits.filter((event) => event.action === 'rewards.config.update').length, 1);
  assert.equal(audits.filter((event) => event.action === 'dopamenu.update').length, 1);
});
