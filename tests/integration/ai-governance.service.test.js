// ============================================================================
// Kairo — Integração da governança e observabilidade de IA (Tarefa 30)
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openSqliteClient } from '../../src/server/database/index.js';
import {
  createAiGovernanceService,
  ensureAiGovernanceSchema
} from '../../src/server/modules/ai/ai-governance.service.js';

function criarContexto(t) {
  const db = openSqliteClient(':memory:');
  const service = createAiGovernanceService({ db });
  t.after(() => db.close());
  return { db, service };
}

test('exige banco real, cria o esquema idempotente e materializa a política inicial', (t) => {
  assert.throws(
    () => createAiGovernanceService(),
    /governança de IA exige uma instância de banco de dados/
  );

  const { db, service } = criarContexto(t);
  assert.doesNotThrow(() => ensureAiGovernanceSchema(db));
  assert.doesNotThrow(() => service.ensureSchema());

  assert.deepEqual(service.getRouterPolicy(), {
    version: 1,
    sensitive_local_only: true,
    tools_require_capability: true,
    fallback_allowed: false,
    max_latency_ms: null
  });
  assert.equal(db.get('SELECT COUNT(*) AS total FROM ai_router_policies').total, 1);
});

test('versiona a política sem perder valores omitidos e permite desativar flags', (t) => {
  const { db, service } = criarContexto(t);
  service.getRouterPolicy();

  const segunda = service.updateRouterPolicy({ fallback_allowed: true, max_latency_ms: 900 }, 41);
  assert.deepEqual(segunda, {
    version: 2,
    sensitive_local_only: true,
    tools_require_capability: true,
    fallback_allowed: true,
    max_latency_ms: 900
  });

  const terceira = service.updateRouterPolicy(
    {
      sensitive_local_only: false,
      tools_require_capability: false,
      fallback_allowed: false
    },
    undefined
  );
  assert.deepEqual(terceira, {
    version: 3,
    sensitive_local_only: false,
    tools_require_capability: false,
    fallback_allowed: false,
    max_latency_ms: 900
  });

  const historico = db.all(
    'SELECT version, active, updated_by FROM ai_router_policies ORDER BY version'
  );
  assert.deepEqual(historico, [
    { version: 1, active: 0, updated_by: null },
    { version: 2, active: 0, updated_by: 41 },
    { version: 3, active: 1, updated_by: null }
  ]);
});

test('roteia dados sensíveis apenas localmente e comunica indisponibilidade com código seguro', (t) => {
  const { service } = criarContexto(t);

  assert.deepEqual(
    service.decideRoute({ sensitive: true, isLocalAvailable: true, isRemoteAvailable: true }),
    {
      decision: 'local',
      reason: 'Dados sensíveis: política local-only.',
      policy_version: 1
    }
  );

  assert.throws(
    () =>
      service.decideRoute({
        sensitive: true,
        isLocalAvailable: false,
        isRemoteAvailable: true
      }),
    (error) => error.status === 422 && error.code === 'ROTA_LOCAL_INDISPONIVEL'
  );
});

test('prefere modelo local, usa remoto permitido e rejeita ausência de rota', (t) => {
  const { service } = criarContexto(t);

  assert.deepEqual(service.decideRoute({ isLocalAvailable: true }), {
    decision: 'local',
    reason: 'Preferência por processamento local.',
    policy_version: 1
  });
  assert.deepEqual(service.decideRoute({ isRemoteAvailable: true }), {
    decision: 'remoto',
    reason: 'Modelo local indisponível; remoto permitido.',
    policy_version: 1
  });
  assert.throws(
    () => service.decideRoute(),
    (error) => error.status === 422 && error.code === 'SEM_ROTA_PERMITIDA'
  );

  service.updateRouterPolicy({ sensitive_local_only: false, fallback_allowed: true });
  assert.equal(
    service.decideRoute({ sensitive: true, isRemoteAvailable: true }).decision,
    'remoto'
  );
});

test('telemetria registra somente metadados e agrega status, tokens, ferramentas e modelos', (t) => {
  const { db, service } = criarContexto(t);

  assert.deepEqual(service.recordExecution(), { recorded: true });
  service.recordExecution({
    user_id: 7,
    provider: 'ollama',
    model: 'qwen3',
    purpose: 'planejamento',
    duration_ms: 120,
    input_tokens: 80,
    output_tokens: 40,
    tool_calls: 2,
    retrieved_memories: 3,
    status: 'erro',
    skill_version: 4
  });
  service.recordExecution({
    provider: 'ollama',
    model: 'qwen3',
    duration_ms: 60,
    input_tokens: 20,
    output_tokens: 10,
    status: 'cancelado'
  });

  const resultado = service.observability();
  assert.equal(resultado.summary.total, 3);
  assert.equal(resultado.summary.errors, 1);
  assert.equal(resultado.summary.canceled, 1);
  assert.equal(resultado.summary.tool_calls, 2);
  assert.equal(resultado.summary.retrievals, 3);
  assert.equal(resultado.summary.input_tokens, 100);
  assert.equal(resultado.summary.output_tokens, 50);
  assert.deepEqual(resultado.by_model[0], {
    provider: 'ollama',
    model: 'qwen3',
    total: 2,
    avg_duration: 90
  });

  const colunas = db.all('PRAGMA table_info(ai_exec_events)').map((coluna) => coluna.name);
  for (const campoSensivel of ['prompt', 'response', 'arguments', 'memory_content']) {
    assert.equal(colunas.includes(campoSensivel), false);
  }
});

test('observabilidade aplica isoladamente os filtros inicial, final e intervalo', (t) => {
  const { db, service } = criarContexto(t);
  service.recordExecution({ provider: 'local', model: 'modelo-a', duration_ms: 10 });
  db.run("UPDATE ai_exec_events SET created_at = '2026-07-20 10:00:00'");
  service.recordExecution({ provider: 'remoto', model: 'modelo-b', duration_ms: 30 });
  db.run("UPDATE ai_exec_events SET created_at = '2026-07-22 10:00:00' WHERE provider = 'remoto'");

  assert.equal(service.observability({ from: '2026-07-21 00:00:00' }).summary.total, 1);
  assert.equal(service.observability({ to: '2026-07-21 23:59:59' }).summary.total, 1);
  assert.equal(
    service.observability({
      from: '2026-07-19 00:00:00',
      to: '2026-07-23 00:00:00'
    }).summary.total,
    2
  );
  assert.equal(
    service.observability({
      from: '2027-01-01 00:00:00',
      to: '2027-01-02 00:00:00'
    }).summary.total,
    0
  );
});
