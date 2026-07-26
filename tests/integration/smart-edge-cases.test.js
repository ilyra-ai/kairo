// ============================================================================
// Kairo — Casos-limite dos recursos inteligentes administráveis
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
import { createActivitiesService } from '../../src/server/modules/activities/activities.service.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';
import { createAutoSchedulerService } from '../../src/server/modules/smart/auto-scheduler.service.js';
import { createBrainDumpService } from '../../src/server/modules/smart/brain-dump.service.js';
import { createDigitalTwinService } from '../../src/server/modules/smart/digital-twin.service.js';
import { createEmotionalMapService } from '../../src/server/modules/smart/emotional-map.service.js';
import { createEnergyBudgetService } from '../../src/server/modules/smart/energy-budget.service.js';
import { createEscalatedRemindersService } from '../../src/server/modules/smart/escalated-reminders.service.js';
import { createFocusTimeMachineService } from '../../src/server/modules/smart/focus-time-machine.service.js';
import { createNowModeService } from '../../src/server/modules/smart/now-mode.service.js';
import { createPassiveTrackingService } from '../../src/server/modules/smart/passive-tracking.service.js';
import { createPredictiveCoachService } from '../../src/server/modules/smart/predictive-coach.service.js';
import { createShutdownRitualService } from '../../src/server/modules/smart/shutdown-ritual.service.js';
import { createSmartFeaturesService } from '../../src/server/modules/smart/smart-features.service.js';
import { createTransitionBridgeService } from '../../src/server/modules/smart/transition-bridge.service.js';

const AGORA = () => new Date('2026-07-22T18:00:00Z');

async function criarContexto(t, { aiService = null, aiTrainingService = null } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-smart-edge-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-smart-edge-com-mais-de-trinta-e-dois-bytes',
    sessionTtlMs: 3_600_000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  await auth.register({ name: 'Titular', email: 'smart@k.local', password: 'senha-teste' });
  const activities = createActivitiesService(db);
  const smart = createSmartFeaturesService({ db, aiService, aiTrainingService });
  smart.ensureSeed();
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, smart, activities };
}

test('todos os engines recusam inicialização sem suas dependências obrigatórias', () => {
  const construtores = [
    createAutoSchedulerService,
    createBrainDumpService,
    createDigitalTwinService,
    createEmotionalMapService,
    createEnergyBudgetService,
    createEscalatedRemindersService,
    createFocusTimeMachineService,
    createNowModeService,
    createPassiveTrackingService,
    createPredictiveCoachService,
    createShutdownRitualService,
    createTransitionBridgeService
  ];
  for (const criar of construtores) assert.throws(() => criar(), /exige/);
  assert.throws(() => createSmartFeaturesService(), /exige uma instância de banco de dados/);
});

test('relógios padrão dos oito engines temporais produzem datas reais válidas', async (t) => {
  const { db, smart } = await criarContexto(t);
  for (const key of [
    'auto_scheduler',
    'emotional_map',
    'energy_budget',
    'persistent_reminders',
    'focus_time_machine',
    'now_mode',
    'predictive_coach',
    'shutdown_ritual'
  ]) {
    smart.updateConfig(key, { enabled: true }, 1);
  }

  const auto = createAutoSchedulerService({ db, smartFeaturesService: smart, agendaService: {} });
  assert.throws(
    () => auto.preview(1),
    (error) => error.code === 'SEM_TAREFAS'
  );
  assert.match(
    createEmotionalMapService({ db, smartFeaturesService: smart }).record(1, {
      mood: 3,
      energy: 3,
      consent: true
    }).check_date,
    /^\d{4}-\d{2}-\d{2}$/
  );
  assert.match(
    createEnergyBudgetService({ db, smartFeaturesService: smart }).computeDay(1).date,
    /^\d{4}-\d{2}-\d{2}$/
  );
  assert.deepEqual(createEscalatedRemindersService({ db, smartFeaturesService: smart }).due(1), []);
  assert.deepEqual(
    createFocusTimeMachineService({ db, smartFeaturesService: smart }).project(1).projections,
    []
  );
  assert.match(
    createNowModeService({ db, smartFeaturesService: smart }).current(1).date,
    /^\d{4}-\d{2}-\d{2}$/
  );
  assert.equal(
    createPredictiveCoachService({ db, smartFeaturesService: smart }).analyze(1).sample,
    0
  );
  assert.match(
    createShutdownRitualService({ db, smartFeaturesService: smart }).summary(1).date,
    /^\d{4}-\d{2}-\d{2}$/
  );
});

test('governança trata recurso ausente, JSON inválido, limites e vínculo de IA', async (t) => {
  let conexaoAtiva = true;
  const aiService = {
    getConnection(id) {
      if (!conexaoAtiva) throw new Error('Conexão removida');
      return { id, is_active: true, health_status: 'ok' };
    },
    listModels() {
      return [{ model_id: 'modelo', capabilities: { chat: true } }];
    }
  };
  const aiTrainingService = {
    getArtifact(id) {
      return { id };
    },
    activeContext() {
      return [{ id: 91, content: 'Treinamento publicado', version: 1 }];
    }
  };
  const { db, smart } = await criarContexto(t, { aiService, aiTrainingService });

  assert.equal(smart.isEnabled('inexistente'), false);
  assert.deepEqual(smart.params('inexistente'), {});
  assert.throws(
    () => smart.get('inexistente'),
    (error) => error.code === 'RECURSO_NAO_ENCONTRADO'
  );
  assert.throws(
    () => smart.updateConfig('inexistente', {}, 1),
    (error) => error.code === 'RECURSO_NAO_ENCONTRADO'
  );

  const preservada = smart.updateConfig('energy_budget', {}, undefined);
  assert.equal(preservada.enabled, false);
  assert.equal(preservada.ai_connection_id, null);
  smart.updateConfig('energy_budget', { ai_connection_id: 77, ai_artifact_id: 91 }, 1);
  assert.equal((await smart.test('energy_budget')).checks.at(-1).ok, true);
  conexaoAtiva = false;
  const falha = await smart.test('energy_budget');
  assert.equal(falha.ready, false);
  assert.equal(falha.checks.find((check) => check.nome === 'ia_vinculada_ativa').ok, false);

  db.run(
    "UPDATE smart_feature_config SET params = 'JSON inválido' WHERE feature_key = 'energy_budget'"
  );
  assert.deepEqual(smart.params('energy_budget').peso_leve, 1);
  assert.equal(smart.listAudit('energy_budget', 0).length > 0, true);
  assert.equal(smart.listAudit('energy_budget', 9999).length > 0, true);
});

test('orçamento valida data, usa o dia atual e cobre cargas leve, média e intensa', async (t) => {
  const { db, smart, activities } = await criarContexto(t);
  smart.updateConfig(
    'energy_budget',
    {
      enabled: true,
      params: {
        orcamento_base: 10,
        limiar_alerta: 0.5,
        peso_leve: 1,
        peso_media: 2,
        peso_intensa: 4
      }
    },
    1
  );
  const activity = activities.create(1, { title: 'Foco' });
  db.run(
    `INSERT INTO agenda_events
       (user_id, activity_id, title, event_date, start_time, end_time, duration_hours, cognitive_load)
     VALUES (1, ?, 'Bloco médio', '2026-07-22', '09:00', '10:00', 1, 2)`,
    [activity.id]
  );
  const budget = createEnergyBudgetService({ db, smartFeaturesService: smart, now: AGORA });

  assert.equal(budget.computeDay(1).near_limit, false);
  assert.throws(
    () => budget.computeDay(1, '22/07/2026'),
    (error) => error.code === 'DATA_INVALIDA'
  );
  assert.deepEqual(
    [1, 2, 3].map((carga) => budget.wouldOverload(1, undefined, carga).added_cost),
    [1, 2, 4]
  );
  assert.equal(budget.wouldOverload(1, undefined, 'inválida').added_cost, 1);

  smart.updateConfig('energy_budget', { params: { orcamento_base: 3, limiar_alerta: 0.5 } }, 1);
  const perto = budget.computeDay(1);
  assert.equal(perto.near_limit, true);
  assert.equal(perto.overloaded, false);
  assert.equal(budget.wouldOverload(1, undefined, 2).would_overload, true);
});

test('mapa emocional cobre consentimento opcional, energia inválida e correlação indefinida', async (t) => {
  const { db, smart, activities } = await criarContexto(t);
  smart.updateConfig(
    'emotional_map',
    { enabled: true, params: { exige_consentimento: false, escala: 3 } },
    1
  );
  const emocional = createEmotionalMapService({ db, smartFeaturesService: smart, now: AGORA });

  assert.throws(
    () => emocional.record(1, { mood: 2, energy: 9 }),
    (error) => error.code === 'ENERGIA_INVALIDA'
  );
  const registro = emocional.record(1, {
    mood: 2.4,
    energy: 2.4,
    date: 'data-inválida',
    note: '  registro privado  '
  });
  assert.equal(registro.check_date, '2026-07-22');
  assert.equal(registro.mood, 2);
  assert.equal(registro.note, 'registro privado');

  const semProdutividade = emocional.map(1, { window_days: 0 });
  assert.equal(semProdutividade.correlated_days, 0);
  assert.equal(semProdutividade.correlations.mood_productivity, null);

  const activity = activities.create(1, { title: 'Foco emocional' });
  db.run(
    `INSERT INTO agenda_events
       (user_id, activity_id, title, event_date, start_time, end_time, duration_hours, is_completed)
     VALUES (1, ?, 'Concluído', '2026-07-22', '09:00', '10:00', 2, 1)`,
    [activity.id]
  );
  const umaAmostra = emocional.map(1, { window_days: 999 });
  assert.equal(umaAmostra.correlated_days, 1);
  assert.equal(umaAmostra.correlations.energy_productivity, null);
});

test('ritual cobre dia vazio, entrada inválida, filtros do plano e limites do histórico', async (t) => {
  const { db, smart } = await criarContexto(t);
  smart.updateConfig(
    'shutdown_ritual',
    { enabled: true, params: { horario_sugerido: '', itens_amanha: 99 } },
    1
  );
  const ritual = createShutdownRitualService({ db, smartFeaturesService: smart, now: AGORA });

  const resumo = ritual.summary(1);
  assert.equal(resumo.suggested_time, '18:00');
  assert.equal(resumo.tomorrow_slots, 10);
  assert.equal(resumo.completed_count, 0);
  assert.match(resumo.closing_message, /Encerre o dia/);
  assert.throws(
    () => ritual.summary(1, { date: 'inválida' }),
    (error) => error.code === 'DATA_INVALIDA'
  );

  const longo = 'x'.repeat(201);
  const vazio = ritual.complete(1, { tomorrow_items: [null, '', longo] });
  assert.deepEqual(vazio.tomorrow_plan, []);
  const semArray = ritual.complete(1, { date: '2026-07-21', tomorrow_items: 'texto' });
  assert.deepEqual(semArray.tomorrow_plan, []);
  assert.equal(ritual.history(1, { limit: 0 }).count, 2);
  assert.equal(ritual.history(1, { limit: 999 }).count, 2);
});
