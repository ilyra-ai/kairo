// ============================================================================
// Kairo — Integração do Ritual de Encerramento (Tarefa 35.12)
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
import { createSmartFeaturesService } from '../../src/server/modules/smart/smart-features.service.js';
import { createShutdownRitualService } from '../../src/server/modules/smart/shutdown-ritual.service.js';

function criarContexto(t, relogio) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-encerramento-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-encerramento-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const activities = createActivitiesService(db);
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const ritual = createShutdownRitualService({ db, smartFeaturesService: smart, now: relogio });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, activities, smart, ritual };
}

function inserirEvento(db, userId, activityId, { date, start, completed, priority }) {
  db.run(
    `INSERT INTO agenda_events (user_id, activity_id, title, event_date, start_time, end_time, duration_hours, is_completed, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, activityId, 'Bloco', date, start, '23:59', 1, completed, priority || 'media']
  );
}

test('desativado bloqueia o resumo', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T18:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  assert.throws(
    () => context.ritual.summary(1, {}),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('summary separa concluídos e pendentes e sugere o amanhã', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T18:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('shutdown_ritual', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });

  inserirEvento(context.db, 1, atividade.id, { date: '2026-07-22', start: '09:00', completed: 1 });
  inserirEvento(context.db, 1, atividade.id, {
    date: '2026-07-22',
    start: '10:00',
    completed: 0,
    priority: 'alta'
  });
  inserirEvento(context.db, 1, atividade.id, { date: '2026-07-22', start: '11:00', completed: 0 });

  const r = context.ritual.summary(1, { date: '2026-07-22' });
  assert.equal(r.completed_count, 1);
  assert.equal(r.pending_count, 2);
  assert.equal(r.suggested_time, '18:00');
  // A pendência de prioridade alta vem primeiro nas sugestões.
  assert.equal(r.tomorrow_suggestions[0].priority, 'alta');
});

test('complete persiste o plano do amanhã e history recupera', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T18:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('shutdown_ritual', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });
  inserirEvento(context.db, 1, atividade.id, { date: '2026-07-22', start: '09:00', completed: 1 });

  const registro = context.ritual.complete(1, {
    date: '2026-07-22',
    tomorrow_items: ['Revisar relatório', 'Ligar para cliente']
  });
  assert.equal(registro.completed_count, 1);
  assert.deepEqual(registro.tomorrow_plan, ['Revisar relatório', 'Ligar para cliente']);

  const hist = context.ritual.history(1, {});
  assert.equal(hist.count, 1);
  assert.deepEqual(hist.rituals[0].tomorrow_plan, ['Revisar relatório', 'Ligar para cliente']);
});

test('complete limita o plano ao número de itens configurado', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T18:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('shutdown_ritual', { enabled: true, params: { itens_amanha: 2 } }, 1);

  const registro = context.ritual.complete(1, {
    date: '2026-07-22',
    tomorrow_items: ['A', 'B', 'C', 'D']
  });
  assert.equal(registro.tomorrow_plan.length, 2);
});

test('complete faz rollover real e idempotente das pendências escolhidas', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T18:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('shutdown_ritual', { enabled: true }, 1);
  const activity = context.activities.create(1, { title: 'Foco' });
  inserirEvento(context.db, 1, activity.id, {
    date: '2026-07-22',
    start: '15:00',
    completed: 0,
    priority: 'alta'
  });

  const first = context.ritual.complete(1, {
    date: '2026-07-22',
    tomorrow_items: ['Bloco']
  });
  assert.equal(first.rolled_count, 1);
  assert.equal(first.rollover_date, '2026-07-23');
  assert.equal(
    context.db.get(
      "SELECT COUNT(*) AS total FROM agenda_events WHERE user_id = 1 AND event_date = '2026-07-23'"
    ).total,
    1
  );

  const repeated = context.ritual.complete(1, {
    date: '2026-07-22',
    tomorrow_items: ['Bloco']
  });
  assert.equal(repeated.rolled_count, 1);
  assert.equal(
    context.db.get(
      "SELECT COUNT(*) AS total FROM agenda_events WHERE user_id = 1 AND event_date = '2026-07-23'"
    ).total,
    1
  );
});
