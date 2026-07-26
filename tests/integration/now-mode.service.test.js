// ============================================================================
// Kairo — Integração do Modo Agora (Tarefa 35.7)
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ensureCoreSchema,
  ensureUserWorkspace,
  openSqliteClient
} from '../../src/server/database/index.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';
import { createActivitiesService } from '../../src/server/modules/activities/activities.service.js';
import { createAgendaService } from '../../src/server/modules/agenda/agenda.service.js';
import { createSmartFeaturesService } from '../../src/server/modules/smart/smart-features.service.js';
import { createNowModeService } from '../../src/server/modules/smart/now-mode.service.js';

function criarContexto(t, relogio) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-modoagora-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-modoagora-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const activities = createActivitiesService(db);
  const agenda = createAgendaService({ db, timeZone: 'America/Sao_Paulo' });
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const nowMode = createNowModeService({
    db,
    smartFeaturesService: smart,
    agendaService: agenda,
    now: relogio
  });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, activities, smart, nowMode };
}

function inserirEvento(db, userId, activityId, { title, date, start, end }) {
  db.run(
    `INSERT INTO agenda_events (user_id, activity_id, title, event_date, start_time, end_time, duration_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, activityId, title, date, start, end, 1]
  );
}

test('desativado bloqueia o Modo Agora', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T12:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  assert.throws(
    () => context.nowMode.current(1),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('current retorna o evento em curso e o próximo', async (t) => {
  // 12:30 UTC — dentro do evento das 12:00–13:00.
  const context = criarContexto(t, () => new Date('2026-07-22T12:30:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('now_mode', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });

  inserirEvento(context.db, 1, atividade.id, {
    title: 'Reunião',
    date: '2026-07-22',
    start: '12:00',
    end: '13:00'
  });
  inserirEvento(context.db, 1, atividade.id, {
    title: 'Deep Work',
    date: '2026-07-22',
    start: '14:00',
    end: '16:00'
  });

  const estado = context.nowMode.current(1);
  assert.equal(estado.now.title, 'Reunião');
  assert.equal(estado.next.title, 'Deep Work');
  assert.equal(estado.idle, false);
});

test('sem evento em curso marca idle e ainda aponta o próximo', async (t) => {
  // 09:00 UTC — antes de qualquer evento.
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('now_mode', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });
  inserirEvento(context.db, 1, atividade.id, {
    title: 'Deep Work',
    date: '2026-07-22',
    start: '14:00',
    end: '16:00'
  });

  const estado = context.nowMode.current(1);
  assert.equal(estado.now, null);
  assert.equal(estado.idle, true);
  assert.equal(estado.next.title, 'Deep Work');
});

test('mostrar_proxima=false oculta a próxima tarefa', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T12:30:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('now_mode', { enabled: true, params: { mostrar_proxima: false } }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });
  inserirEvento(context.db, 1, atividade.id, {
    title: 'Reunião',
    date: '2026-07-22',
    start: '12:00',
    end: '13:00'
  });
  inserirEvento(context.db, 1, atividade.id, {
    title: 'Deep Work',
    date: '2026-07-22',
    start: '14:00',
    end: '16:00'
  });

  const estado = context.nowMode.current(1);
  assert.equal(estado.show_next, false);
  assert.equal(estado.next, null);
});

test('ações concluem e adiam o compromisso real com isolamento por usuário', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T12:30:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('now_mode', { enabled: true }, 1);
  const activity = context.activities.create(1, { title: 'Foco' });
  inserirEvento(context.db, 1, activity.id, {
    title: 'Deep Work',
    date: '2026-07-22',
    start: '12:00',
    end: '13:00'
  });
  const eventId = context.db.get('SELECT id FROM agenda_events WHERE user_id = 1').id;

  const postponed = context.nowMode.act(1, eventId, { action: 'postpone', minutes: 15 });
  assert.equal(postponed.start_time, '12:15');
  assert.equal(postponed.end_time, '13:15');
  assert.throws(
    () => context.nowMode.act(2, eventId, { action: 'complete' }),
    (error) => error.code === 'COMPROMISSO_NAO_ENCONTRADO'
  );
  const completed = context.nowMode.act(1, eventId, { action: 'complete' });
  assert.equal(completed.is_completed, true);
});
