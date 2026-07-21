// ============================================================================
// Kairo — Integração do assistente de IA com ações reais (Tarefa 16)
// ----------------------------------------------------------------------------
// Modelo simulado via `fetch` injetável (a lógica de ações é real): prova que
// criação executa só após confirmação, exclusão exige confirmação, leitura
// executa direto e a ação confirmada altera o banco de verdade.
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  ensureCoreSchema,
  ensureUserWorkspace,
  openSqliteClient
} from '../../src/server/database/index.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';
import { createActivitiesService } from '../../src/server/modules/activities/activities.service.js';
import { createAgendaService } from '../../src/server/modules/agenda/agenda.service.js';
import { createAiService } from '../../src/server/modules/ai/ai.service.js';
import { createAiAssistantService } from '../../src/server/modules/ai/ai-assistant.service.js';

const KEK = randomBytes(32);
const RESOLVER = async () => ['127.0.0.1'];

// fetch simulado: /api/tags descobre; /api/chat devolve tool_calls conforme a
// última mensagem do usuário (para dirigir o teste de forma determinística).
function fetchSimulado() {
  return async (url, init) => {
    const u = String(url);
    if (u.endsWith('/api/tags')) {
      return resp({ models: [{ model: 'gemma', name: 'gemma' }] });
    }
    if (u.endsWith('/api/chat')) {
      const body = JSON.parse(init.body);
      const ultima = body.messages[body.messages.length - 1]?.content || '';
      const toolCalls = [];
      if (/criar.*atividade|nova atividade/i.test(ultima)) {
        toolCalls.push({ function: { name: 'criar_atividade', arguments: { title: 'Estudar' } } });
      } else if (/excluir/i.test(ultima)) {
        toolCalls.push({ function: { name: 'excluir_atividade', arguments: { activity_id: 1 } } });
      } else if (/listar|minhas atividades/i.test(ultima)) {
        toolCalls.push({ function: { name: 'listar_atividades', arguments: {} } });
      }
      return resp({ message: { content: 'Ok', tool_calls: toolCalls } });
    }
    return resp({}, 404);
  };
}

function resp(body, status = 200) {
  return {
    ok: status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-assistente-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-assistente-com-mais-de-trinta-e-dois-bytes-2026',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const activities = createActivitiesService(db);
  const agenda = createAgendaService({ db, timeZone: 'America/Sao_Paulo' });
  const ai = createAiService({
    db,
    encryptionKey: KEK,
    fetchImpl: fetchSimulado(),
    resolver: RESOLVER,
    defaultTimeoutMs: 2000,
    defaultMaxRetries: 0
  });
  const assistant = createAiAssistantService({
    db,
    aiService: ai,
    activitiesService: activities,
    agendaService: agenda
  });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, ai, activities, assistant };
}

async function prepararUsuarioEModelo(context) {
  await context.auth.register({ name: 'Titular', email: 'u@k.local', password: 'senha-teste' });
  // O workspace inicial semeia atividades padrão; zeramos para contagens
  // determinísticas neste teste (o CASCADE remove períodos/metas vinculados).
  context.db.run('DELETE FROM agenda_events WHERE user_id = 1');
  context.db.run('DELETE FROM activities WHERE user_id = 1');
  const conn = await context.ai.createConnection(
    { name: 'Ollama', provider_type: 'ollama', base_url: 'http://127.0.0.1:11434' },
    1
  );
  const [modelo] = await context.ai.discoverModels(conn.id);
  // Confirma capacidade de chat para o roteamento por capacidade.
  await context.ai.capabilityCheck(modelo.id);
  return { userId: 1, modelo };
}

test('criação de atividade é PROPOSTA (não executa sem confirmação) e confirma altera o banco', async (t) => {
  const context = criarContexto(t);
  const { userId } = await prepararUsuarioEModelo(context);

  const r1 = await context.assistant.chat(userId, {
    messages: [{ role: 'user', content: 'crie uma nova atividade chamada Estudar' }]
  });
  // Nada foi criado ainda; veio uma proposta com confirmação obrigatória.
  assert.equal(r1.proposals.length, 1);
  assert.equal(r1.proposals[0].tool, 'criar_atividade');
  assert.equal(r1.proposals[0].confirmation_required, true);
  assert.equal(context.activities.list(userId).length, 0);

  // Confirma → executa de verdade.
  const r2 = await context.assistant.chat(userId, {
    messages: [{ role: 'user', content: 'confirmo' }],
    confirm: { tool: 'criar_atividade', arguments: { title: 'Estudar' } }
  });
  assert.equal(r2.executions.length, 1);
  const lista = context.activities.list(userId);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].title, 'Estudar');
});

test('leitura (listar atividades) executa diretamente, sem confirmação', async (t) => {
  const context = criarContexto(t);
  const { userId } = await prepararUsuarioEModelo(context);
  context.activities.create(userId, { title: 'Trabalho' });

  const r = await context.assistant.chat(userId, {
    messages: [{ role: 'user', content: 'liste minhas atividades' }]
  });
  assert.equal(r.proposals.length, 0);
  assert.equal(r.executions.length, 1);
  assert.equal(r.executions[0].tool, 'listar_atividades');
  assert.ok(Array.isArray(r.executions[0].result));
  assert.equal(r.executions[0].result.length, 1);
});

test('exclusão exige confirmação e afeta apenas o registro correto', async (t) => {
  const context = criarContexto(t);
  const { userId } = await prepararUsuarioEModelo(context);
  const a1 = context.activities.create(userId, { title: 'Apagar' });
  context.activities.create(userId, { title: 'Manter' });

  const r1 = await context.assistant.chat(userId, {
    messages: [{ role: 'user', content: 'excluir a atividade Apagar' }]
  });
  assert.equal(r1.proposals.length, 1);
  assert.equal(r1.proposals[0].risk, 'destrutiva');
  assert.equal(context.activities.list(userId).length, 2);

  await context.assistant.chat(userId, {
    messages: [{ role: 'user', content: 'confirmo' }],
    confirm: { tool: 'excluir_atividade', arguments: { activity_id: a1.id } }
  });
  const restantes = context.activities.list(userId);
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].title, 'Manter');
});

test('copiloto sugere sem aplicar (nunca altera sem aceite)', async (t) => {
  const context = criarContexto(t);
  const { userId } = await prepararUsuarioEModelo(context);
  const r = await context.assistant.copilot(userId, { kind: 'clareza', text: 'fzr relatorio' });
  assert.equal(r.applied, false);
  assert.equal(r.kind, 'clareza');
  assert.equal(typeof r.suggestion, 'string');
});
