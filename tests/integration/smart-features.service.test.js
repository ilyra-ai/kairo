// ============================================================================
// Kairo — Integração da governança de recursos inteligentes (Tarefa 35.0)
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openSqliteClient } from '../../src/server/database/index.js';
import {
  SMART_FEATURES,
  createSmartFeaturesService
} from '../../src/server/modules/smart/smart-features.service.js';

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-smart-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  const service = createSmartFeaturesService({ db });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, service };
}

test('seed semeia os 12 recursos uma única vez e todos começam desativados', async (t) => {
  const { service } = criarContexto(t);
  const r = service.ensureSeed();
  assert.equal(r.seeded, true);
  assert.equal(r.count, SMART_FEATURES.length);
  assert.equal(SMART_FEATURES.length, 12);

  const lista = service.list();
  assert.equal(lista.length, 12);
  assert.ok(lista.every((f) => f.enabled === false), 'recursos nascem desativados');

  // Idempotência.
  assert.equal(service.ensureSeed().seeded, false);
});

test('admin ativa, edita parâmetros e a auditoria registra', async (t) => {
  const { service } = criarContexto(t);
  service.ensureSeed();

  const atualizado = service.updateConfig(
    'energy_budget',
    { enabled: true, params: { orcamento_base: 16 } },
    1
  );
  assert.equal(atualizado.enabled, true);
  assert.equal(atualizado.params.orcamento_base, 16);
  // Parâmetros não informados preservam o padrão (merge).
  assert.equal(atualizado.params.limiar_alerta, 0.9);

  assert.equal(service.isEnabled('energy_budget'), true);
  assert.equal(service.params('energy_budget').orcamento_base, 16);

  const audit = service.listAudit('energy_budget');
  assert.ok(audit.some((e) => e.action === 'config.update'));
});

test('recurso desativado bloqueia o engine (assertEnabled)', async (t) => {
  const { service } = criarContexto(t);
  service.ensureSeed();
  assert.throws(
    () => service.assertEnabled('auto_scheduler'),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
  service.updateConfig('auto_scheduler', { enabled: true }, 1);
  assert.doesNotThrow(() => service.assertEnabled('auto_scheduler'));
});

test('dry-run (test) valida configuração', async (t) => {
  const { service } = criarContexto(t);
  service.ensureSeed();
  const r = service.test('brain_dump');
  assert.equal(r.ready, true);
  assert.ok(Array.isArray(r.checks));
});
