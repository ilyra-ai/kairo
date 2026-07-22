// ============================================================================
// Kairo — Integração do Gêmeo Digital de Produtividade (Tarefa 35.10)
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
import { createDigitalTwinService } from '../../src/server/modules/smart/digital-twin.service.js';

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-gemeo-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-gemeo-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const activities = createActivitiesService(db);
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const twin = createDigitalTwinService({ db, smartFeaturesService: smart });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, activities, smart, twin };
}

function inserirEvento(db, userId, activityId, { date, start, horas, load, completed }) {
  db.run(
    `INSERT INTO agenda_events (user_id, activity_id, title, event_date, start_time, end_time, duration_hours, cognitive_load, is_completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, activityId, 'Bloco', date, start, '23:59', horas, load, completed]
  );
}

// Popula N dias com 1 evento concluído de `horas` cada.
function popularDias(db, userId, activityId, dias, horas) {
  for (let i = 1; i <= dias; i += 1) {
    inserirEvento(db, userId, activityId, {
      date: `2026-07-${String(i).padStart(2, '0')}`,
      start: '09:00',
      horas,
      load: 2,
      completed: 1
    });
  }
}

test('desativado bloqueia o perfil', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  assert.throws(
    () => context.twin.profile(1),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('amostra insuficiente retorna sufficient=false', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('digital_twin', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });
  popularDias(context.db, 1, atividade.id, 3, 2); // 3 dias < 7 mínimo

  const p = context.twin.profile(1);
  assert.equal(p.sufficient, false);
  assert.equal(p.days_with_data, 3);
});

test('com amostra suficiente constrói o modelo com capacidade e taxa', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('digital_twin', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });
  popularDias(context.db, 1, atividade.id, 8, 2); // 8 dias, 2h concluídas/dia

  const p = context.twin.profile(1);
  assert.equal(p.sufficient, true);
  assert.equal(p.days_with_data, 8);
  assert.equal(p.completion_rate, 1);
  assert.equal(p.estimated_daily_capacity_hours, 2);
});

test('simulate compara o plano contra a capacidade do modelo', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('digital_twin', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });
  popularDias(context.db, 1, atividade.id, 8, 2); // capacidade ~2h/dia

  // Plano de 5h excede a capacidade de 2h.
  const excede = context.twin.simulate(1, {
    tasks: [
      { title: 'A', hours: 3, cognitive_load: 2 },
      { title: 'B', hours: 2, cognitive_load: 1 }
    ]
  });
  assert.equal(excede.fits_capacity, false);
  assert.ok(excede.estimated_completion_probability < 1);

  // Plano de 1.5h cabe na capacidade.
  const cabe = context.twin.simulate(1, { tasks: [{ title: 'C', hours: 1.5, cognitive_load: 1 }] });
  assert.equal(cabe.fits_capacity, true);
});
