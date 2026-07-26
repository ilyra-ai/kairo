// ============================================================================
// Kairo — Integração do assistente persistente e das ferramentas reais
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  ensureCoreSchema,
  ensureUserWorkspace,
  openSqliteClient
} from '../../src/server/database/index.js';
import { createActivitiesService } from '../../src/server/modules/activities/activities.service.js';
import { createAgendaService } from '../../src/server/modules/agenda/agenda.service.js';
import { createAiAssistantService } from '../../src/server/modules/ai/ai-assistant.service.js';
import { createAiService } from '../../src/server/modules/ai/ai.service.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';

const KEK = randomBytes(32);
const RESOLVER = async (host) =>
  host === 'provedor.example.com' ? ['203.0.113.40'] : ['127.0.0.1'];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function sseResponse(text) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
}

function createModelController() {
  let nextToolCall = null;
  let nextText = 'Resposta final baseada nos dados reais.';
  const requests = [];
  return {
    tool(name, args) {
      nextToolCall = { name, arguments: args };
    },
    text(value) {
      nextText = value;
    },
    requests() {
      return requests;
    },
    async fetch(url, init) {
      const address = String(url);
      if (address.endsWith('/api/tags')) {
        return jsonResponse({ models: [{ model: 'gemma', name: 'gemma' }] });
      }
      if (address.endsWith('/v1/models')) {
        return jsonResponse({ data: [{ id: 'modelo-remoto' }] });
      }
      if (address.endsWith('/api/embed') || address.endsWith('/v1/embeddings')) {
        return jsonResponse({ embeddings: [[0.1, 0.2]], data: [{ embedding: [0.1, 0.2] }] });
      }
      if (address.endsWith('/api/chat') || address.endsWith('/v1/chat/completions')) {
        const body = JSON.parse(init.body);
        requests.push(body);
        if (body.stream && address.endsWith('/v1/chat/completions')) return sseResponse('ok');
        const ping = body.tools?.find((item) => item.function?.name === 'kairo_ping');
        if (ping) {
          const call = { function: { name: 'kairo_ping', arguments: {} } };
          return address.endsWith('/api/chat')
            ? jsonResponse({ message: { content: '', tool_calls: [call] } })
            : jsonResponse({ choices: [{ message: { content: '', tool_calls: [call] } }] });
        }
        if (Array.isArray(body.tools) && nextToolCall) {
          const call = { function: nextToolCall };
          nextToolCall = null;
          return address.endsWith('/api/chat')
            ? jsonResponse({ message: { content: '', tool_calls: [call] } })
            : jsonResponse({ choices: [{ message: { content: '', tool_calls: [call] } }] });
        }
        return address.endsWith('/api/chat')
          ? jsonResponse({ message: { content: nextText, tool_calls: [] } })
          : jsonResponse({ choices: [{ message: { content: nextText, tool_calls: [] } }] });
      }
      return jsonResponse({}, 404);
    }
  };
}

function createContext(t, { assistantOptions = {} } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-assistente-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-assistente-com-mais-de-trinta-e-dois-bytes-2026',
    sessionTtlMs: 3_600_000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const model = createModelController();
  const ai = createAiService({
    db,
    encryptionKey: KEK,
    fetchImpl: model.fetch,
    resolver: RESOLVER,
    defaultTimeoutMs: 2_000,
    defaultMaxRetries: 0
  });
  const activities = createActivitiesService(db);
  const agenda = createAgendaService({
    db,
    timeZone: 'America/Sao_Paulo',
    now: () => new Date('2026-07-26T12:00:00.000Z')
  });
  const assistant = createAiAssistantService({
    db,
    encryptionKey: KEK,
    aiService: ai,
    activitiesService: activities,
    agendaService: agenda,
    now: () => new Date('2026-07-26T12:00:00.000Z'),
    ...assistantOptions
  });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, model, ai, activities, agenda, assistant };
}

async function createUser(context, suffix) {
  const user = await context.auth.register({
    name: `Titular ${suffix}`,
    email: `${suffix}@kairo.local`,
    password: 'senha-teste'
  });
  context.db.run('DELETE FROM agenda_events WHERE user_id = ?', [user.user.id]);
  context.db.run('DELETE FROM activities WHERE user_id = ?', [user.user.id]);
  return user.user.id;
}

async function enableLocalModel(context) {
  const connection = await context.ai.createConnection(
    { name: 'Ollama', provider_type: 'ollama', base_url: 'http://127.0.0.1:11434' },
    1
  );
  const [model] = await context.ai.discoverModels(connection.id);
  await context.ai.capabilityCheck(model.id);
  return { connection, model };
}

async function propose(context, userId, tool, args, message = 'Execute esta ação.') {
  context.model.tool(tool, args);
  const result = await context.assistant.chat(userId, { message });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].tool, tool);
  return result.proposals[0];
}

test('proposta é criptografada, vinculada ao usuário, expira e só executa uma vez', async (t) => {
  const context = createContext(t);
  const first = await createUser(context, 'primeiro');
  const second = await createUser(context, 'segundo');
  await enableLocalModel(context);

  const proposal = await propose(context, first, 'criar_categoria', { title: 'Estudar' });
  assert.equal(proposal.arguments, undefined);
  assert.equal(context.activities.list(first).length, 0);
  const stored = context.db.get(
    'SELECT encrypted_arguments FROM ai_assistant_proposals WHERE id = ?',
    [proposal.proposal_id]
  );
  assert.ok(stored.encrypted_arguments.startsWith('kairo:v1:'));
  assert.equal(stored.encrypted_arguments.includes('Estudar'), false);

  await assert.rejects(
    context.assistant.chat(second, { confirm: { proposal_id: proposal.proposal_id } }),
    (error) => error.code === 'PROPOSTA_INDISPONIVEL'
  );
  await assert.rejects(
    context.assistant.chat(first, { confirm: { proposal_id: randomUUID() } }),
    (error) => error.code === 'PROPOSTA_INDISPONIVEL'
  );

  const executed = await context.assistant.chat(first, {
    confirm: { proposal_id: proposal.proposal_id }
  });
  assert.equal(executed.executions[0].tool, 'criar_categoria');
  assert.equal(context.activities.list(first)[0].title, 'Estudar');
  await assert.rejects(
    context.assistant.chat(first, { confirm: { proposal_id: proposal.proposal_id } }),
    (error) => error.code === 'PROPOSTA_INDISPONIVEL'
  );

  const expiring = await propose(context, first, 'criar_categoria', { title: 'Expirada' });
  context.db.run('UPDATE ai_assistant_proposals SET expires_at = 0 WHERE id = ?', [
    expiring.proposal_id
  ]);
  await assert.rejects(
    context.assistant.chat(first, { confirm: { proposal_id: expiring.proposal_id } }),
    (error) => error.code === 'PROPOSTA_INDISPONIVEL'
  );
});

test('histórico é criptografado, isolado por usuário, recuperável e eliminável', async (t) => {
  const context = createContext(t);
  const first = await createUser(context, 'historico-um');
  const second = await createUser(context, 'historico-dois');
  await enableLocalModel(context);
  context.model.text('Resposta privada do assistente.');

  await context.assistant.chat(first, { message: 'Meu conteúdo confidencial.' });
  const raw = context.db.all('SELECT ciphertext FROM ai_assistant_messages WHERE user_id = ?', [
    first
  ]);
  assert.equal(raw.length, 2);
  assert.equal(
    raw.some((row) => row.ciphertext.includes('confidencial')),
    false
  );
  assert.deepEqual(
    context.assistant.history(first).messages.map((item) => item.role),
    ['user', 'assistant']
  );
  assert.equal(context.assistant.history(second).messages.length, 0);

  context.model.text('Outra resposta.');
  await context.assistant.chat(second, { message: 'Mensagem do segundo.' });
  const cleared = context.assistant.clearHistory(first);
  assert.equal(cleared.deleted_messages, 2);
  assert.equal(context.assistant.history(first).messages.length, 0);
  assert.equal(context.assistant.history(second).messages.length, 2);
});

test('cancelamento de proposta persiste e impede execução posterior', async (t) => {
  const context = createContext(t);
  const userId = await createUser(context, 'cancelamento');
  await enableLocalModel(context);
  const proposal = await propose(context, userId, 'criar_categoria', { title: 'Não criar' });

  assert.equal(context.assistant.cancelProposal(userId, proposal.proposal_id).canceled, true);
  assert.equal(context.assistant.history(userId).proposals.length, 0);
  await assert.rejects(
    context.assistant.chat(userId, { confirm: { proposal_id: proposal.proposal_id } }),
    (error) => error.code === 'PROPOSTA_INDISPONIVEL'
  );
  assert.equal(context.activities.list(userId).length, 0);
});

test('ferramentas reais cobrem categoria, tarefa, conclusão, disponibilidade, metas e foco', async (t) => {
  const context = createContext(t);
  const userId = await createUser(context, 'ferramentas');
  await enableLocalModel(context);

  const categoryProposal = await propose(context, userId, 'criar_categoria', {
    title: 'Trabalho',
    color: '#7c6fff'
  });
  const categoryResult = await context.assistant.chat(userId, {
    confirm: { proposal_id: categoryProposal.proposal_id }
  });
  const categoryId = categoryResult.executions[0].result.id;

  const categoryEdit = await propose(context, userId, 'editar_categoria', {
    activity_id: categoryId,
    title: 'Trabalho estratégico'
  });
  await context.assistant.chat(userId, { confirm: { proposal_id: categoryEdit.proposal_id } });
  assert.equal(context.activities.getDetails(userId, categoryId).title, 'Trabalho estratégico');

  const goalProposal = await propose(context, userId, 'definir_meta', {
    activity_id: categoryId,
    timeframe: 'weekly',
    target_hours: 12
  });
  await context.assistant.chat(userId, { confirm: { proposal_id: goalProposal.proposal_id } });
  assert.equal(context.activities.getDetails(userId, categoryId).goals.weekly, 12);

  const taskProposal = await propose(context, userId, 'criar_tarefa', {
    activity_id: categoryId,
    title: 'Revisar relatório',
    description: 'Revisão final',
    event_date: '2026-07-27',
    start_time: '09:00',
    end_time: '10:00',
    priority: 'alta',
    cognitive_load: 2,
    event_color: '#7c6fff'
  });
  const taskResult = await context.assistant.chat(userId, {
    confirm: { proposal_id: taskProposal.proposal_id }
  });
  const eventId = taskResult.executions[0].result.id;

  const editProposal = await propose(context, userId, 'editar_tarefa', {
    event_id: eventId,
    title: 'Revisar relatório executivo'
  });
  await context.assistant.chat(userId, { confirm: { proposal_id: editProposal.proposal_id } });
  assert.equal(context.agenda.get(userId, eventId).title, 'Revisar relatório executivo');

  const completion = await propose(context, userId, 'concluir_tarefa', {
    event_id: eventId,
    is_completed: true
  });
  await context.assistant.chat(userId, { confirm: { proposal_id: completion.proposal_id } });
  assert.equal(context.agenda.get(userId, eventId).is_completed, true);

  context.model.tool('consultar_disponibilidade', {
    event_date: '2026-07-27',
    start_time: '09:30',
    end_time: '10:30'
  });
  const availability = await context.assistant.chat(userId, { message: 'Tenho horário livre?' });
  assert.equal(availability.executions[0].result.available, false);
  assert.equal(availability.executions[0].result.conflicts[0].id, eventId);

  context.model.tool('consultar_metas', {});
  const goals = await context.assistant.chat(userId, { message: 'Mostre minhas metas.' });
  assert.equal(goals.executions[0].result[0].activity_id, categoryId);

  context.model.tool('sugerir_bloco_foco', { title: 'Relatório', duration_minutes: 25 });
  const focus = await context.assistant.chat(userId, { message: 'Sugira foco.' });
  assert.equal(focus.executions[0].result.preset, 'classico');
  assert.equal(focus.executions[0].result.started, false);

  const deletion = await propose(context, userId, 'excluir_tarefa', { event_id: eventId });
  await context.assistant.chat(userId, { confirm: { proposal_id: deletion.proposal_id } });
  assert.equal(context.agenda.list(userId).length, 0);
});

test('argumentos inválidos são recusados antes de qualquer proposta persistida', async (t) => {
  const context = createContext(t);
  const userId = await createUser(context, 'argumentos-invalidos');
  await enableLocalModel(context);
  context.model.tool('criar_tarefa', {
    activity_id: 999,
    title: 'Inválida',
    event_date: 'amanhã',
    start_time: '09:00',
    end_time: '08:00'
  });

  await assert.rejects(
    context.assistant.chat(userId, { message: 'Crie esta tarefa.' }),
    (error) => error.code === 'ARGUMENTOS_FERRAMENTA_INVALIDOS'
  );
  assert.equal(
    context.db.get('SELECT COUNT(*) AS total FROM ai_assistant_proposals WHERE user_id = ?', [
      userId
    ]).total,
    0
  );
});

test('políticas publicadas restringem ferramentas e podem exigir confirmação também para leitura', async (t) => {
  const aiTrainingService = {
    activeContext: () => [
      {
        name: 'Escopo mínimo',
        content: 'Consulte metas somente após confirmação explícita.',
        allowed_tools: ['consultar_metas'],
        allowed_data: ['metas']
      }
    ],
    listToolPolicies: () => [
      {
        tool_name: 'consultar_metas',
        allowed: 1,
        requires_confirmation: 1,
        destructive: 0
      }
    ]
  };
  const context = createContext(t, { assistantOptions: { aiTrainingService } });
  const userId = await createUser(context, 'politicas');
  await enableLocalModel(context);
  assert.deepEqual(
    context.assistant.tools(userId).map((tool) => tool.name),
    ['consultar_metas']
  );

  context.model.tool('consultar_metas', {});
  const answer = await context.assistant.chat(userId, { message: 'Mostre as metas.' });
  assert.equal(answer.executions.length, 0);
  assert.equal(answer.proposals.length, 1);
  assert.equal(answer.proposals[0].risk, 'escrita');
  const confirmed = await context.assistant.chat(userId, {
    confirm: { proposal_id: answer.proposals[0].proposal_id }
  });
  assert.equal(confirmed.executions[0].tool, 'consultar_metas');
});

test('AAD vincula mensagem à identidade e ao papel e detecta adulteração no banco', async (t) => {
  const context = createContext(t);
  const userId = await createUser(context, 'aad');
  await enableLocalModel(context);
  await context.assistant.chat(userId, { message: 'Mensagem protegida.' });
  const row = context.db.get(
    'SELECT id, role FROM ai_assistant_messages WHERE user_id = ? ORDER BY id ASC LIMIT 1',
    [userId]
  );
  context.db.run('UPDATE ai_assistant_messages SET role = ? WHERE id = ?', [
    row.role === 'user' ? 'assistant' : 'user',
    row.id
  ]);
  assert.throws(() => context.assistant.history(userId), /autentica|decifra|cript/i);
});

test('contexto enviado ao modelo respeita orçamento agregado do histórico', async (t) => {
  const context = createContext(t);
  const userId = await createUser(context, 'orcamento');
  await enableLocalModel(context);
  context.model.text('x'.repeat(12_000));
  await context.assistant.chat(userId, { message: 'Primeira.' });
  await context.assistant.chat(userId, { message: 'Segunda.' });
  await context.assistant.chat(userId, { message: 'Terceira.' });

  const lastRequest = context.model.requests().at(-1);
  const historyCharacters = lastRequest.messages
    .slice(1, -1)
    .reduce((total, message) => total + String(message.content || '').length, 0);
  assert.ok(historyCharacters <= 24_000, `histórico excedeu o orçamento: ${historyCharacters}`);
});

test('as nove assistências sugerem sem aplicar e preservam o original', async (t) => {
  const context = createContext(t);
  const userId = await createUser(context, 'copiloto');
  await enableLocalModel(context);
  const kinds = [
    'correcao',
    'clareza',
    'passos',
    'dicas',
    'microtarefas',
    'estimativa',
    'dependencias',
    'prioridade',
    'criterio'
  ];
  for (const kind of kinds) {
    context.model.text(`Sugestão ${kind}`);
    const result = await context.assistant.copilot(userId, {
      kind,
      text: 'fzr relatorio'
    });
    assert.equal(result.kind, kind);
    assert.equal(result.original, 'fzr relatorio');
    assert.equal(result.applied, false);
    assert.equal(result.suggestion, `Sugestão ${kind}`);
  }
  assert.equal(context.activities.list(userId).length, 0);
  assert.equal(context.agenda.list(userId).length, 0);
});

test('provedor remoto exige consentimento explícito antes de receber texto', async (t) => {
  const context = createContext(t);
  const userId = await createUser(context, 'remoto');
  const remote = await context.ai.createConnection(
    {
      name: 'Remoto',
      provider_type: 'openai-compatible',
      base_url: 'https://provedor.example.com/v1',
      api_key: 'segredo-remoto',
      is_local: false,
      allow_remote_host: true
    },
    1
  );
  const [model] = await context.ai.discoverModels(remote.id);
  await context.ai.capabilityCheck(model.id);
  assert.equal(context.assistant.status().is_local, false);

  await assert.rejects(
    context.assistant.chat(userId, { message: 'Não autorizado.' }),
    (error) => error.code === 'CONSENTIMENTO_REMOTO_NECESSARIO'
  );
  context.model.text('Resposta remota autorizada.');
  const result = await context.assistant.chat(userId, {
    message: 'Agora autorizado.',
    remote_consent: true
  });
  assert.equal(result.is_local, false);
  assert.equal(result.message, 'Resposta remota autorizada.');
});

test('contratos de erro e mensagens de fallback permanecem explícitos e persistentes', async (t) => {
  assert.throws(() => createAiAssistantService({}), /exige banco/i);
  const context = createContext(t);
  const userId = await createUser(context, 'contratos-erro');

  const unavailable = context.assistant.status(userId);
  assert.equal(unavailable.available, false);
  assert.equal(context.assistant.history(userId, { limit: 0 }).messages.length, 0);
  assert.ok(context.assistant.tools().length > 0);
  await assert.rejects(
    context.assistant.chat(userId, { message: '  ' }),
    (error) => error.code === 'MENSAGEM_VAZIA'
  );
  await assert.rejects(
    context.assistant.copilot(userId, { kind: 'inexistente', text: 'Texto' }),
    (error) => error.code === 'ASSISTENCIA_INVALIDA'
  );
  await assert.rejects(
    context.assistant.copilot(userId, { kind: 'clareza', text: 'x' }),
    (error) => error.code === 'TEXTO_VAZIO'
  );

  await enableLocalModel(context);
  context.model.text('');
  const generic = await context.assistant.chat(userId, { message: 'Responda.' });
  assert.equal(generic.message, 'Não consegui produzir uma resposta útil para este pedido.');

  context.model.tool('criar_categoria', { title: 'Proposta vazia' });
  const proposed = await context.assistant.chat(userId, { message: 'Proponha.' });
  assert.equal(proposed.message, 'Preparei a ação abaixo. Revise e confirme para executá-la.');

  context.model.tool('consultar_metas', {});
  const consulted = await context.assistant.chat(userId, { message: 'Consulte.' });
  assert.equal(consulted.message, 'Consulta concluída com dados atualizados.');

  context.model.tool('ferramenta_inexistente', {});
  await assert.rejects(
    context.assistant.chat(userId, { message: 'Ferramenta inválida.' }),
    (error) => error.code === 'FERRAMENTA_NAO_AUTORIZADA'
  );

  await assert.rejects(
    context.assistant.copilot(userId, { kind: 'clareza', text: 'Texto válido' }),
    (error) => error.code === 'SUGESTAO_VAZIA'
  );
});
