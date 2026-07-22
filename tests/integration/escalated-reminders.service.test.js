// ============================================================================
// Kairo — Integração dos Lembretes Persistentes Escalonados (Tarefa 35.6)
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
import { createEscalatedRemindersService } from '../../src/server/modules/smart/escalated-reminders.service.js';

function criarContexto(t, relogio) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-lembretes-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-lembretes-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const reminders = createEscalatedRemindersService({
    db,
    smartFeaturesService: smart,
    now: relogio
  });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, smart, reminders };
}

test('desativado bloqueia o agendamento', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:00:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  assert.throws(
    () => context.reminders.schedule(1, { title: 'X', base_at: '2026-07-22 09:00' }),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('schedule cria pendente e due lista os vencidos', async (t) => {
  const relogio = () => new Date('2026-07-22T09:05:00Z');
  const context = criarContexto(t, relogio);
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('persistent_reminders', { enabled: true }, 1);

  const criado = context.reminders.schedule(1, {
    title: 'Enviar relatório',
    base_at: '2026-07-22 09:00'
  });
  assert.equal(criado.status, 'pendente');
  assert.equal(criado.level, 0);

  const vencidos = context.reminders.due(1);
  assert.equal(vencidos.length, 1);
  assert.equal(vencidos[0].id, criado.id);
});

test('escalate avança níveis e esgota após o máximo configurado', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:05:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig(
    'persistent_reminders',
    { enabled: true, params: { intervalos_min: [5, 15, 30], max_escalonamentos: 2 } },
    1
  );
  const criado = context.reminders.schedule(1, { title: 'X', base_at: '2026-07-22 09:00' });

  const n1 = context.reminders.escalate(1, { id: criado.id });
  assert.equal(n1.level, 1);
  assert.equal(n1.status, 'pendente');

  const n2 = context.reminders.escalate(1, { id: criado.id });
  assert.equal(n2.level, 2);

  // Terceiro escalonamento excede o máximo (2) -> esgotado.
  const n3 = context.reminders.escalate(1, { id: criado.id });
  assert.equal(n3.status, 'esgotado');
});

test('act conclui ou adia conscientemente', async (t) => {
  const context = criarContexto(t, () => new Date('2026-07-22T09:05:00Z'));
  await context.auth.register({ name: 'T', email: 'u@k.local', password: 'senha-teste' });
  context.smart.updateConfig('persistent_reminders', { enabled: true }, 1);

  const a = context.reminders.schedule(1, { title: 'A', base_at: '2026-07-22 09:00' });
  const concluido = context.reminders.act(1, { id: a.id, action: 'done' });
  assert.equal(concluido.status, 'concluido');

  const b = context.reminders.schedule(1, { title: 'B', base_at: '2026-07-22 09:00' });
  const adiado = context.reminders.act(1, { id: b.id, action: 'snooze', snooze_minutes: 20 });
  assert.equal(adiado.status, 'adiado');
  // Após adiar 20 min a partir de 09:05, não está mais vencido às 09:05.
  const vencidos = context.reminders.due(1);
  assert.ok(!vencidos.some((r) => r.id === b.id));
});
