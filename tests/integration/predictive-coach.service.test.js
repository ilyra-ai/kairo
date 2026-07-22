// ============================================================================
// Kairo — Integração do Coach Preditivo Proativo (Tarefa 35.8)
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
import { createPredictiveCoachService } from '../../src/server/modules/smart/predictive-coach.service.js';

function criarContexto(t, relogio) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-coach-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-coach-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const activities = createActivitiesService(db);
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const coach = createPredictiveCoachService({ db, smartFeaturesService: smart, now: relogio });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, activities, smart, coach };
}

function inserirEvento(db, userId, activityId, { date, start, load, completed }) {
  db.run(
    `INSERT INTO agenda_events (user_id, activity_id, title, event_date, start_time, end_time, duration_hours, cognitive_load, is_completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, activityId, 'Bloco', date, start, '23:59', 1, load, completed]
  );
}

test('desativado bloqueia a análise', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  assert.throws(
    () => context.coach.analyze(1),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('sem histórico retorna amostra zero e nenhum insight', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('predictive_coach', { enabled: true }, 1);
  const r = context.coach.analyze(1);
  assert.equal(r.sample, 0);
  assert.equal(r.insights.length, 0);
});

test('detecta procrastinação quando a taxa de não-conclusão supera o limiar', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('predictive_coach', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });

  // 4 eventos recentes, 3 não concluídos (75% > limiar 0.5).
  inserirEvento(context.db, 1, atividade.id, {
    date: '2026-07-21',
    start: '09:00',
    load: 1,
    completed: 0
  });
  inserirEvento(context.db, 1, atividade.id, {
    date: '2026-07-21',
    start: '10:00',
    load: 1,
    completed: 0
  });
  inserirEvento(context.db, 1, atividade.id, {
    date: '2026-07-20',
    start: '11:00',
    load: 1,
    completed: 0
  });
  inserirEvento(context.db, 1, atividade.id, {
    date: '2026-07-20',
    start: '12:00',
    load: 1,
    completed: 1
  });

  const r = context.coach.analyze(1);
  assert.ok(r.insights.some((i) => i.type === 'procrastinacao'));
});

test('detecta sobrecarga quando a carga diária excede o orçamento', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('predictive_coach', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });

  // Um único dia com 6 eventos de carga intensa (peso 3 -> 18 > orçamento 12).
  for (let i = 0; i < 6; i += 1) {
    inserirEvento(context.db, 1, atividade.id, {
      date: '2026-07-21',
      start: `${String(8 + i).padStart(2, '0')}:00`,
      load: 3,
      completed: 1
    });
  }

  const r = context.coach.analyze(1);
  assert.ok(r.insights.some((i) => i.type === 'sobrecarga'));
});
