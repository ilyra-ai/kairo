// ============================================================================
// Kairo — Integração do Rastreamento Passivo Inteligente (Tarefa 35.3)
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
import { createPassiveTrackingService } from '../../src/server/modules/smart/passive-tracking.service.js';

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-passivo-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-passivo-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const activities = createActivitiesService(db);
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const passive = createPassiveTrackingService({
    db,
    smartFeaturesService: smart,
    activitiesService: activities
  });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, activities, smart, passive };
}

test('desativado bloqueia o registro passivo', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  assert.throws(
    () => context.passive.record(1, { section: 'Dashboard' }),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('registra sessões e o resumo sugere seções com foco relevante', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('passive_tracking', { enabled: true }, 1);

  // 10 minutos de foco em "Relatórios" (acima do limiar) e 1 min em "Ajuda".
  context.passive.record(1, { section: 'Relatórios', layout: 'grid', focus_seconds: 600 });
  context.passive.record(1, { section: 'Ajuda', layout: 'lista', focus_seconds: 60 });

  const resumo = context.passive.summary(1, {});
  assert.equal(resumo.sections.length, 2);
  const relatorios = resumo.sections.find((s) => s.section === 'Relatórios');
  assert.equal(relatorios.focus_minutes, 10);
  // Só "Relatórios" vira sugestão (Ajuda ficou abaixo do limiar de 5 min).
  assert.equal(resumo.suggestions.length, 1);
  assert.equal(resumo.suggestions[0].section, 'Relatórios');
});

test('promote cria atividade real apenas com ação explícita', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('passive_tracking', { enabled: true }, 1);
  context.db.run('DELETE FROM activities WHERE user_id = 1');

  const r = context.passive.promote(1, { title: 'Trabalho em Relatórios' });
  assert.equal(r.created, true);
  const total = context.db.get('SELECT COUNT(*) AS t FROM activities WHERE user_id = 1').t;
  assert.equal(total, 1);
});
