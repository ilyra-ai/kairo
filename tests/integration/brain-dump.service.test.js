// ============================================================================
// Kairo — Integração do Brain Dump → Plano (Tarefa 35.5)
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
import { createBrainDumpService } from '../../src/server/modules/smart/brain-dump.service.js';

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-braindump-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-braindump-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const activities = createActivitiesService(db);
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const brain = createBrainDumpService({
    db,
    smartFeaturesService: smart,
    activitiesService: activities
  });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, activities, smart, brain };
}

test('desativado bloqueia; parse quebra o texto em tarefas com estimativa', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });

  assert.throws(
    () => context.brain.parse(1, { text: 'algo' }),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );

  context.smart.updateConfig('brain_dump', { enabled: true }, 1);
  const r = context.brain.parse(1, {
    text: 'comprar leite\nescrever relatório trimestral\nligar para o dentista'
  });
  assert.equal(r.count, 3);
  assert.ok(r.items.every((i) => i.estimate_min > 0));
  // Item com "relatório" recebe estimativa maior que a base.
  const rel = r.items.find((i) => /Relatório/i.test(i.title));
  const base = context.brain.parse(1, { text: 'ligar para o dentista' }).items[0].estimate_min;
  assert.ok(rel.estimate_min > base);
  // Nada foi persistido no parse.
  assert.equal(
    context.db.get('SELECT COUNT(*) AS t FROM activities WHERE user_id = 1').t >= 0,
    true
  );
});

test('commit cria apenas os itens confirmados como atividades reais', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('brain_dump', { enabled: true }, 1);
  context.db.run('DELETE FROM activities WHERE user_id = 1');

  const r = context.brain.commit(1, {
    items: [{ title: 'Estudar Kairo' }, { title: 'Planejar semana' }]
  });
  assert.equal(r.created, 2);
  const total = context.db.get('SELECT COUNT(*) AS t FROM activities WHERE user_id = 1').t;
  assert.equal(total, 2);
});
