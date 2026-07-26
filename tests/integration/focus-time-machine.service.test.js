// ============================================================================
// Kairo — Integração da Máquina do Tempo do Foco (Tarefa 35.9)
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
import { createFocusTimeMachineService } from '../../src/server/modules/smart/focus-time-machine.service.js';

function criarContexto(t, relogio) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-maquina-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-maquina-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const activities = createActivitiesService(db);
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const machine = createFocusTimeMachineService({ db, smartFeaturesService: smart, now: relogio });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, activities, smart, machine };
}

function inserirEventoConcluido(db, userId, activityId, { date, horas }) {
  db.run(
    `INSERT INTO agenda_events (user_id, activity_id, title, event_date, start_time, end_time, duration_hours, is_completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [userId, activityId, 'Bloco', date, '09:00', '10:00', horas]
  );
}

test('desativado bloqueia a projeção', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  assert.throws(
    () => context.machine.project(1, {}),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('sem metas retorna projeções vazias com orientação', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('focus_time_machine', { enabled: true }, 1);
  const r = context.machine.project(1, {});
  assert.equal(r.projections.length, 0);
});

test('projeta ritmo atual fora do horizonte e ajuste dentro do horizonte', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  // horizonte 10 dias.
  context.smart.updateConfig(
    'focus_time_machine',
    { enabled: true, params: { horizonte_dias: 10 } },
    1
  );
  const atividade = context.activities.create(1, { title: 'Estudo' });
  // Meta de 20h.
  context.db.run('INSERT INTO goals (activity_id, type, target_hours) VALUES (?, ?, ?)', [
    atividade.id,
    'monthly',
    20
  ]);
  // 10h concluídas na janela de 10 dias -> ritmo 1h/dia -> 20 dias > 10 (fora).
  for (let i = 1; i <= 10; i += 1) {
    inserirEventoConcluido(context.db, 1, atividade.id, {
      date: `2026-07-${String(12 + i).padStart(2, '0')}`,
      horas: 1
    });
  }

  const atual = context.machine.project(1, { rhythm_window_days: 10 });
  const p = atual.projections[0];
  assert.equal(p.daily_rate_hours, 1);
  assert.equal(p.days_to_goal, 20);
  assert.equal(p.within_horizon, false);

  // Ajuste +1h/dia -> 2h/dia -> 10 dias <= 10 (dentro).
  const ajustado = context.machine.project(1, { rhythm_window_days: 10, extra_hours_per_day: 1 });
  assert.equal(ajustado.projections[0].adjusted.days_to_goal, 10);
  assert.equal(ajustado.projections[0].adjusted.within_horizon, true);

  const persisted = context.machine.simulate(1, {
    rhythm_window_days: 10,
    extra_hours_per_day: 1
  });
  assert.ok(persisted.projection_id > 0);
  const raw = context.db.get('SELECT * FROM goal_projections WHERE id = ?', [
    persisted.projection_id
  ]);
  assert.equal(raw.user_id, 1);
  assert.equal(JSON.parse(raw.assumptions_json).extra_hours_per_day, 1);
});

test('ritmo zero torna a meta inatingível (days_to_goal nulo)', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('focus_time_machine', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Estudo' });
  context.db.run('INSERT INTO goals (activity_id, type, target_hours) VALUES (?, ?, ?)', [
    atividade.id,
    'monthly',
    10
  ]);
  // Nenhum evento concluído -> ritmo 0.
  const r = context.machine.project(1, {});
  assert.equal(r.projections[0].days_to_goal, null);
  assert.equal(r.projections[0].within_horizon, false);
  assert.equal(r.at_risk, 1);
});
