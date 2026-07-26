// ============================================================================
// Kairo — Integração da Ponte de Transição entre Tarefas (Tarefa 35.4)
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
import { createSmartFeaturesService } from '../../src/server/modules/smart/smart-features.service.js';
import { createTransitionBridgeService } from '../../src/server/modules/smart/transition-bridge.service.js';

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-transicao-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-transicao-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const bridge = createTransitionBridgeService({ db, smartFeaturesService: smart });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, smart, bridge };
}

test('desativado bloqueia o roteiro da ponte', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  assert.throws(
    () => context.bridge.plan(1, { from: 'A', to: 'B' }),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('plan gera passos de respiração e preparação da próxima tarefa', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('transition_bridge', { enabled: true }, 1);

  const plano = context.bridge.plan(1, { from: 'Email', to: 'Relatório' });
  assert.equal(plano.ritual_type, 'respiracao');
  assert.ok(plano.steps.length >= 3);
  assert.ok(plano.total_seconds > 0);
  assert.ok(/Relatório/.test(plano.next_prep));
});

test('plan respeita o tipo contagem configurado pelo administrador', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig(
    'transition_bridge',
    { enabled: true, params: { tipo: 'contagem', duracao_seg: 30 } },
    1
  );
  const plano = context.bridge.plan(1, {});
  assert.equal(plano.ritual_type, 'contagem');
  // Último passo é sempre "Comece".
  assert.equal(plano.steps[plano.steps.length - 1].label, 'Comece');
});

test('complete registra a transição e stats agrega a aderência', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('transition_bridge', { enabled: true }, 1);

  context.bridge.complete(1, { from: 'A', to: 'B', duration_seconds: 30, completed: true });
  context.bridge.complete(1, { from: 'B', to: 'C', duration_seconds: 20, completed: false });

  const stats = context.bridge.stats(1);
  assert.equal(stats.total, 2);
  assert.equal(stats.completed, 1);
  assert.equal(stats.completion_ratio, 0.5);
  assert.equal(stats.average_seconds, 25);
});

test('preferências do usuário substituem o ritual e permitem desativar a oferta', async (t) => {
  const context = criarContexto(t);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('transition_bridge', { enabled: true }, 1);

  context.bridge.updatePreferences(1, {
    enabled: true,
    ritual_type: 'som',
    sound_enabled: false
  });
  const personalized = context.bridge.plan(1, {});
  assert.equal(personalized.ritual_type, 'som');
  assert.equal(personalized.sound_enabled, false);

  context.bridge.updatePreferences(1, { enabled: false });
  assert.throws(
    () => context.bridge.plan(1, {}),
    (error) => error.code === 'TRANSICAO_DESATIVADA_PELO_USUARIO'
  );
});
