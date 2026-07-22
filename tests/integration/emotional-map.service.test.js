// ============================================================================
// Kairo — Integração do Mapa Emocional × Produtividade (Tarefa 35.11)
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
import { createEmotionalMapService } from '../../src/server/modules/smart/emotional-map.service.js';

function criarContexto(t, relogio) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-emocional-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-emocional-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const activities = createActivitiesService(db);
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const emo = createEmotionalMapService({ db, smartFeaturesService: smart, now: relogio });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, activities, smart, emo };
}

function inserirEventoConcluido(db, userId, activityId, date, horas) {
  db.run(
    `INSERT INTO agenda_events (user_id, activity_id, title, event_date, start_time, end_time, duration_hours, is_completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [userId, activityId, 'Bloco', date, '09:00', '10:00', horas]
  );
}

test('desativado bloqueia o registro', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  assert.throws(
    () => context.emo.record(1, { mood: 4, energy: 4, consent: true }),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('exige consentimento explícito para registrar', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('emotional_map', { enabled: true }, 1);
  assert.throws(
    () => context.emo.record(1, { mood: 4, energy: 4 }),
    (e) => e.code === 'CONSENTIMENTO_NECESSARIO'
  );
});

test('valida a escala configurada', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('emotional_map', { enabled: true }, 1);
  assert.throws(
    () => context.emo.record(1, { mood: 9, energy: 3, consent: true }),
    (e) => e.code === 'HUMOR_INVALIDO'
  );
});

test('correlaciona humor crescente com produtividade crescente (positiva)', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('emotional_map', { enabled: true }, 1);
  const atividade = context.activities.create(1, { title: 'Foco' });

  // 5 dias: humor 1..5 e horas concluídas 1..5 (correlação perfeita positiva).
  for (let i = 1; i <= 5; i += 1) {
    const date = `2026-07-${String(17 + i).padStart(2, '0')}`;
    context.emo.record(1, { mood: i, energy: i, date, consent: true });
    inserirEventoConcluido(context.db, 1, atividade.id, date, i);
  }

  const mapa = context.emo.map(1, { window_days: 30 });
  assert.equal(mapa.correlated_days, 5);
  assert.equal(mapa.correlations.mood_productivity, 1);
  assert.ok(mapa.disclaimer.includes('não um diagnóstico'));
});
