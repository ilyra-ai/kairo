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
  assert.ok(
    lista.every((f) => f.enabled === false),
    'recursos nascem desativados'
  );

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
  const r = await service.test('brain_dump');
  assert.equal(r.ready, true);
  assert.ok(Array.isArray(r.checks));
});

test('admin exclui somente recurso desativado e restaura pelo catálogo homologado', async (t) => {
  const { service } = criarContexto(t);
  service.ensureSeed();
  service.updateConfig('brain_dump', { enabled: true }, 7);

  assert.throws(
    () => service.remove('brain_dump', 7),
    (error) => error.code === 'RECURSO_ATIVO'
  );
  service.updateConfig('brain_dump', { enabled: false }, 7);
  assert.deepEqual(service.remove('brain_dump', 7), { deleted: true, key: 'brain_dump' });
  assert.equal(service.list().length, 11);
  assert.equal(
    service.listTemplates().find((template) => template.key === 'brain_dump').available,
    true
  );

  const restored = service.create({ key: 'brain_dump', enabled: true }, 7);
  assert.equal(restored.enabled, true);
  assert.equal(restored.name, 'Brain Dump → Plano Instantâneo');
  assert.equal(service.list().length, 12);
  assert.ok(service.listAudit('brain_dump').some((event) => event.action === 'catalog.create'));
});

test('camada opcional de IA executa chat real com modelo confirmado e artefato publicado', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-smart-ai-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  const calls = [];
  const aiService = {
    getConnection: (id) => ({
      id,
      is_active: true,
      is_local: true,
      health_status: 'ok',
      provider_type: 'lmstudio'
    }),
    listModels: () => [
      {
        model_id: 'modelo-local',
        is_default: true,
        capabilities: { chat: true }
      }
    ],
    runChat: async (payload) => {
      calls.push(payload);
      return { text: 'Sugestão baseada no contexto real.', provider: 'lmstudio', is_local: true };
    }
  };
  const aiTrainingService = {
    getArtifact: (id) => ({ id }),
    activeContext: () => [
      {
        id: 91,
        content: 'Priorize recomendações curtas e verificáveis.',
        version: 4
      }
    ]
  };
  const service = createSmartFeaturesService({ db, aiService, aiTrainingService });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  service.ensureSeed();
  service.updateConfig(
    'predictive_coach',
    { enabled: true, ai_connection_id: 5, ai_artifact_id: 91 },
    1
  );

  const result = await service.generateAssistance(
    'predictive_coach',
    { userId: 12, role: 'usuario', plan: 'pro' },
    { purpose: 'coaching', context: { risco: 'sobrecarga', horas: 9 } }
  );

  assert.equal(result.text, 'Sugestão baseada no contexto real.');
  assert.equal(result.is_local, true);
  assert.equal(result.artifact_version, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'modelo-local');
  assert.match(calls[0].messages[0].content, /Priorize recomendações/);
  assert.match(calls[0].messages[1].content, /sobrecarga/);
  const audit = service.listAudit('predictive_coach');
  assert.ok(audit.some((event) => event.action === 'ai.assistance'));
  assert.ok(audit.every((event) => !String(event.detail).includes('sobrecarga')));
});

test('camada opcional de IA falha fechada sem conexão configurada', async (t) => {
  const { service } = criarContexto(t);
  service.ensureSeed();
  service.updateConfig('digital_twin', { enabled: true }, 1);

  await assert.rejects(
    service.generateAssistance(
      'digital_twin',
      { userId: 2, role: 'usuario', plan: 'free' },
      { context: { scenario: 'sem conexão' } }
    ),
    (error) => error.code === 'IA_NAO_CONFIGURADA'
  );
});
