// ============================================================================
// Kairo — Integração do Estúdio de Treinamento governado de IA (Tarefa 27)
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openSqliteClient } from '../../src/server/database/index.js';
import { ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { createAiTrainingService } from '../../src/server/modules/ai/ai-training.service.js';
import { createAiGovernanceService } from '../../src/server/modules/ai/ai-governance.service.js';

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-treino-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  db.run(
    `INSERT INTO users (name, email, password_hash, role, plan)
     VALUES ('Admin', 'admin@kairo.local', 'hash', 'administrador', 'pro')`
  );
  const service = createAiTrainingService({ db });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, service };
}

function avaliarAprovarPublicar(service, artifact, actorId = 1) {
  const evaluation = service.evaluateArtifact(artifact.id, actorId);
  assert.equal(evaluation.approved, true);
  service.approveVersion(
    artifact.id,
    {
      version: artifact.current_version,
      rationale: 'Aprovação explícita da versão avaliada para publicação.'
    },
    actorId
  );
  return service.publishArtifact(artifact.id, actorId);
}

test('CRUD + versionamento: editar cria nova versão e mantém histórico', async (t) => {
  const { service } = criarContexto(t);
  const artefato = service.createArtifact(
    {
      name: 'Skill de foco',
      type: 'skill',
      description: 'Ajuda no foco',
      content: 'Recomende blocos de foco de 25 minutos com pausas.'
    },
    1
  );
  assert.equal(artefato.current_version, 1);
  assert.equal(artefato.state, 'rascunho');

  const editado = service.updateArtifact(
    artefato.id,
    { content: 'Recomende blocos de foco de 50 minutos com pausas de 10.' },
    1
  );
  assert.equal(editado.current_version, 2);
  const versoes = service.listVersions(artefato.id);
  assert.equal(versoes.length, 2);
});

test('pipeline: artefato inválido é reprovado e não publica; válido publica e reverte', async (t) => {
  const { service } = criarContexto(t);

  // Inválido: conteúdo muito curto.
  const invalido = service.createArtifact({ name: 'Vazio', type: 'skill', content: 'oi' }, 1);
  const avaliacao = service.evaluateArtifact(invalido.id);
  assert.equal(avaliacao.approved, false);
  assert.throws(
    () => service.publishArtifact(invalido.id, 1),
    (e) => e.code === 'AVALIACAO_REPROVADA'
  );

  // Válido: publica.
  const valido = service.createArtifact(
    {
      name: 'Skill boa',
      type: 'skill',
      content: 'Decomponha a tarefa em micro-passos acionáveis.'
    },
    1
  );
  const publicado = avaliarAprovarPublicar(service, valido);
  assert.equal(publicado.state, 'publicado');
  assert.equal(publicado.published_version, 1);

  // Nova versão publicada e rollback para a anterior.
  service.updateArtifact(
    valido.id,
    { content: 'Nova orientação de decomposição em etapas menores.' },
    1
  );
  avaliarAprovarPublicar(service, service.getArtifact(valido.id));
  assert.equal(service.getArtifact(valido.id).published_version, 2);

  const revertido = service.rollbackArtifact(valido.id, 1);
  assert.equal(revertido.published_version, 1);
});

test('regra_ferramenta exige confirmação humana para ser aprovada', async (t) => {
  const { service } = criarContexto(t);
  const semConfirmacao = service.createArtifact(
    { name: 'Regra ruim', type: 'regra_ferramenta', content: 'Pode apagar tudo automaticamente.' },
    1
  );
  assert.equal(service.evaluateArtifact(semConfirmacao.id).approved, false);

  const comConfirmacao = service.createArtifact(
    {
      name: 'Regra boa',
      type: 'regra_ferramenta',
      content: 'Exclusões e pagamentos exigem confirmação explícita do usuário antes de executar.'
    },
    1
  );
  assert.equal(service.evaluateArtifact(comConfirmacao.id).approved, true);
});

test('seed das competências: cria uma única vez, publica e compõe o contexto ativo', async (t) => {
  const { service } = criarContexto(t);
  const primeira = service.ensureSeedCompetencies(1);
  assert.equal(primeira.seeded, true);
  assert.equal(primeira.count, 8);

  // Idempotência: segunda chamada não recria.
  const segunda = service.ensureSeedCompetencies(1);
  assert.equal(segunda.seeded, false);

  // Contexto ativo tem as 8 competências publicadas, ordenadas por prioridade.
  const contexto = service.activeContext();
  assert.equal(contexto.length, 8);
  assert.ok(contexto[0].priority <= contexto[contexto.length - 1].priority);

  // O administrador pode excluir QUALQUER item, inclusive semeados; e o seed
  // não recria itens excluídos no próximo boot (estado em ai_seed_state).
  const idSeed = service.listArtifacts()[0].id;
  assert.doesNotThrow(() => service.deleteArtifact(idSeed, 1));
  assert.equal(service.listArtifacts().length, 7);
  const reaplicar = service.ensureSeedCompetencies(1);
  assert.equal(reaplicar.seeded, false, 'seed não deve recriar itens excluídos');
  assert.equal(service.listArtifacts().length, 7);
});

test('contexto ativo aplica escopos de plano, perfil e funcionalidade e expõe limites de dados/ferramentas', async (t) => {
  const { service } = criarContexto(t);
  const artifacts = [
    { name: 'Global', scope: 'global' },
    { name: 'Plano Pro', scope: 'plano', scope_ref: 'pro' },
    { name: 'Assistente', scope: 'funcionalidade', scope_ref: 'ai_assistant' },
    { name: 'Somente Admin', scope: 'perfil', scope_ref: 'administrador' }
  ].map((item) =>
    service.createArtifact(
      {
        ...item,
        type: 'skill',
        content: `Instrução governada válida para o escopo ${item.name}.`,
        allowed_tools: ['consultar_agenda'],
        allowed_data: ['agenda']
      },
      1
    )
  );
  for (const artifact of artifacts) avaliarAprovarPublicar(service, artifact);

  const context = service.activeContext({
    plan: 'pro',
    role: 'usuario',
    feature: 'ai_assistant'
  });
  assert.deepEqual(
    context.map((item) => item.name),
    ['Global', 'Plano Pro', 'Assistente']
  );
  assert.deepEqual(context[0].allowed_tools, ['consultar_agenda']);
  assert.deepEqual(context[0].allowed_data, ['agenda']);
});

test('seed de skills e workflows 2026: cria os 16 itens uma única vez e são editáveis/removíveis', async (t) => {
  const { service } = criarContexto(t);
  const primeira = service.ensureSeedSkillsWorkflows(1);
  assert.equal(primeira.seeded, true);
  assert.equal(primeira.count, 16);

  // Idempotência real via estado de seed.
  const segunda = service.ensureSeedSkillsWorkflows(1);
  assert.equal(segunda.seeded, false);

  // Há workflows e skills entre os itens semeados.
  const workflows = service.listArtifacts({ type: 'workflow' });
  const skills = service.listArtifacts({ type: 'skill' });
  assert.ok(workflows.length >= 8);
  assert.ok(skills.length >= 4);

  // Qualquer item pode ser editado (nova versão) e excluído.
  const alvo = workflows[0];
  const editado = service.updateArtifact(alvo.id, { description: 'Ajustado pelo admin.' }, 1);
  assert.equal(editado.current_version, alvo.current_version + 1);
  assert.doesNotThrow(() => service.deleteArtifact(alvo.id, 1));
});

test('seed de skills de domínio do Kairo: cobre os módulos do app uma única vez', async (t) => {
  const { service } = criarContexto(t);
  const primeira = service.ensureSeedDomainSkills(1);
  assert.equal(primeira.seeded, true);
  assert.equal(primeira.count, 10);

  // Idempotência.
  assert.equal(service.ensureSeedDomainSkills(1).seeded, false);

  // Cobre os módulos reais (agenda, categorias, metas, relatórios, energia, etc.).
  const nomes = service.listArtifacts().map((a) => a.name);
  for (const modulo of [
    'Agenda',
    'categorias',
    'Metas',
    'Relatórios',
    'energia',
    'Google Agenda'
  ]) {
    assert.ok(
      nomes.some((n) => n.toLowerCase().includes(modulo.toLowerCase())),
      `esperado skill cobrindo: ${modulo}`
    );
  }
});

test('políticas de ferramenta e auditoria registram ações', async (t) => {
  const { service } = criarContexto(t);
  const pendente = service.upsertToolPolicy(
    {
      tool_name: 'excluir_atividade',
      description: 'Exclui atividade',
      allowed: true,
      requires_confirmation: true,
      destructive: true
    },
    1
  );
  assert.equal(pendente.approval_status, 'pendente');
  service.decideToolPolicy(
    'excluir_atividade',
    'approve',
    1,
    'Política destrutiva revisada e aprovada pelo administrador.'
  );
  const politicas = service.listToolPolicies();
  assert.equal(politicas.length, 1);
  assert.equal(Number(politicas[0].requires_confirmation), 1);

  const auditoria = service.listAudit();
  assert.ok(auditoria.some((e) => e.action === 'training.tool_policy.upsert'));
});

test('LLMOps bloqueia regressão, compara snapshots e exige aprovação humana vigente', async (t) => {
  const { service } = criarContexto(t);
  const artifact = service.createArtifact(
    {
      name: 'Skill versionada',
      type: 'skill',
      description: 'Contexto completo para avaliação contínua.',
      content:
        'Oriente o usuário com passos claros, seguros e verificáveis antes de concluir cada ação.'
    },
    1
  );
  avaliarAprovarPublicar(service, artifact);

  const candidate = service.updateArtifact(
    artifact.id,
    { description: '', content: 'Oriente com passos claros.' },
    1
  );
  const evaluation = service.evaluateArtifact(candidate.id, 1);
  assert.equal(evaluation.approved, true, 'a suíte essencial permanece aprovada');
  assert.equal(evaluation.release_approved, false, 'a regressão impede o release');
  assert.ok(evaluation.regression < -evaluation.regression_threshold);
  service.approveVersion(
    candidate.id,
    {
      version: 2,
      rationale: 'Aprovação humana registrada para comprovar o bloqueio da regressão.'
    },
    1
  );
  assert.throws(
    () => service.publishArtifact(candidate.id, 1),
    (error) => error.code === 'REGRESSAO_ACIMA_DO_LIMITE'
  );

  const comparison = service.compareVersions(candidate.id, 1, 2);
  assert.ok(comparison.changed_fields.some((change) => change.field === 'content'));
  assert.ok(comparison.changed_fields.some((change) => change.field === 'description'));
  assert.equal(service.listEvaluations(candidate.id).length, 2);
});

test('canary roteia coorte estável, agrega tráfego real e promove somente após a amostra', async (t) => {
  const { service } = criarContexto(t);
  const artifact = service.createArtifact(
    {
      name: 'Canary governado',
      type: 'skill',
      description: 'Versão base suficientemente documentada.',
      content: 'Versão base com orientação detalhada, segura e acionável para o usuário final.'
    },
    1
  );
  avaliarAprovarPublicar(service, artifact);
  const candidate = service.updateArtifact(
    artifact.id,
    {
      description: 'Versão candidata suficientemente documentada.',
      content: 'Versão candidata com orientação detalhada, segura e acionável para o usuário final.'
    },
    1
  );
  service.evaluateArtifact(candidate.id, 1);
  service.approveVersion(
    candidate.id,
    { version: 2, rationale: 'Candidato aprovado para exposição canary controlada.' },
    1
  );
  const canary = service.startCanary(
    candidate.id,
    { version: 2, traffic_percent: 100, min_samples: 2, max_error_rate: 10 },
    1
  );
  const context = service.activeContext({ userId: 77, plan: 'pro', role: 'usuario' });
  assert.equal(context[0].version, 2);
  assert.equal(context[0].canary_id, canary.id);
  assert.throws(
    () =>
      service.finishCanary(
        canary.id,
        { action: 'promote', reason: 'Tentativa antes da amostra mínima obrigatória.' },
        1
      ),
    (error) => error.code === 'CANARY_AMOSTRA_INSUFICIENTE'
  );
  service.recordCanaryObservation({ canary_id: canary.id, user_id: 77, status: 'sucesso' });
  service.recordCanaryObservation({ canary_id: canary.id, user_id: 78, status: 'sucesso' });
  const promoted = service.finishCanary(
    canary.id,
    { action: 'promote', reason: 'Amostra mínima aprovada sem erros observados.' },
    1
  );
  assert.equal(promoted.status, 'promovido');
  assert.equal(service.getArtifact(candidate.id).published_version, 2);
});

test('governança de ferramentas aplica escopos, limites, aprovação e revogação', async (t) => {
  const { service } = criarContexto(t);
  service.upsertToolPolicy(
    {
      tool_name: 'consultar_agenda',
      risk_class: 'somente_leitura',
      read_scopes: ['agenda'],
      max_calls: 1,
      window_seconds: 60
    },
    1
  );
  assert.throws(
    () =>
      service.authorizeToolCall({
        tool_name: 'consultar_agenda',
        user_id: 1,
        operation: 'read',
        scope: 'agenda'
      }),
    (error) => error.code === 'FERRAMENTA_NAO_APROVADA'
  );
  service.decideToolPolicy(
    'consultar_agenda',
    'approve',
    1,
    'Escopo de leitura e limite revisados pelo administrador.'
  );
  assert.equal(
    service.authorizeToolCall({
      tool_name: 'consultar_agenda',
      user_id: 1,
      operation: 'read',
      scope: 'agenda'
    }).allowed,
    true
  );
  assert.throws(
    () =>
      service.authorizeToolCall({
        tool_name: 'consultar_agenda',
        user_id: 1,
        operation: 'read',
        scope: 'agenda'
      }),
    (error) => error.code === 'LIMITE_FERRAMENTA_EXCEDIDO'
  );
  service.decideToolPolicy(
    'consultar_agenda',
    'revoke',
    1,
    'Acesso revogado por decisão administrativa explícita.'
  );
  assert.equal(service.listToolAudit().length, 3);
});

test('servidores MCP nascem desativados e só aprovam allowlist revisada sem aceitar token literal', async (t) => {
  const { service } = criarContexto(t);
  const server = service.createMcpServer(
    {
      name: 'MCP local governado',
      server_url: 'http://127.0.0.1:3100/mcp',
      transport: 'streamable_http',
      auth_type: 'none',
      requested_scopes: ['agenda.read'],
      allowlisted: false,
      tools_reviewed: false
    },
    1
  );
  assert.equal(server.enabled, false);
  assert.equal(server.approval_status, 'pendente');
  assert.throws(
    () =>
      service.decideMcpServer(
        server.id,
        { action: 'approve', rationale: 'Tentativa sem revisão completa do servidor.' },
        1
      ),
    (error) => error.code === 'MCP_REVISAO_INCOMPLETA'
  );
  service.updateMcpServer(server.id, { allowlisted: true, tools_reviewed: true }, 1);
  const approved = service.decideMcpServer(
    server.id,
    { action: 'approve', rationale: 'Servidor e ferramentas revisados pelo administrador.' },
    1
  );
  assert.equal(approved.approval_status, 'aprovada');
  assert.equal(approved.enabled, false, 'aprovar nunca habilita automaticamente');
  service.deleteMcpServer(server.id, 1);
  assert.equal(service.listMcpServers().length, 0);
});

test('LLMOps cobre bloqueios, revogação, canary abortado, rollback dirigido e scorecards', async (t) => {
  const { db, service } = criarContexto(t);
  createAiGovernanceService({ db });
  const artifact = service.createArtifact(
    {
      name: 'Fluxo governado',
      type: 'skill',
      description: 'Artefato para cobrir decisões negativas do pipeline.',
      content: 'Conteúdo completo, seguro e acionável para o pipeline governado de publicação.'
    },
    1
  );
  assert.throws(
    () =>
      service.approveVersion(
        artifact.id,
        { version: 1, rationale: 'Aprovação sem avaliação deve ser recusada.' },
        1
      ),
    (error) => error.code === 'AVALIACAO_ATUAL_APROVADA_AUSENTE'
  );
  service.evaluateArtifact(artifact.id, 1, { evaluator: 'suite-kairo', model_id: 7 });
  assert.throws(
    () => service.publishArtifact(artifact.id, 1),
    (error) => error.code === 'APROVACAO_HUMANA_AUSENTE'
  );
  service.approveVersion(
    artifact.id,
    { version: 1, rationale: 'Versão inicial avaliada e aprovada para publicação.' },
    1
  );
  service.revokeVersionApproval(
    artifact.id,
    { version: 1, rationale: 'A aprovação foi revogada antes da publicação.' },
    1
  );
  assert.throws(
    () => service.publishArtifact(artifact.id, 1),
    (error) => error.code === 'APROVACAO_HUMANA_AUSENTE'
  );
  service.approveVersion(
    artifact.id,
    { version: 1, rationale: 'Nova revisão humana liberou a versão para publicação.' },
    1
  );
  service.publishArtifact(artifact.id, 1, { version: 1 });

  const candidate = service.updateArtifact(
    artifact.id,
    {
      description: 'Candidato documentado para teste de erro e abortagem.',
      content: 'Candidato completo, seguro e acionável para teste controlado de canary.'
    },
    1
  );
  service.evaluateArtifact(candidate.id, 1);
  service.approveVersion(
    candidate.id,
    { version: 2, rationale: 'Candidato revisado para exposição controlada.' },
    1
  );
  const canary = service.startCanary(
    candidate.id,
    { traffic_percent: 50, min_samples: 1, max_error_rate: 0 },
    1
  );
  assert.throws(
    () =>
      service.startCanary(
        candidate.id,
        { traffic_percent: 10, min_samples: 1, max_error_rate: 0 },
        1
      ),
    (error) => error.code === 'CANARY_JA_EM_ANDAMENTO'
  );
  assert.equal(
    service.recordCanaryObservation({ canary_id: 99999, status: 'sucesso' }).recorded,
    false
  );
  service.recordCanaryObservation({
    canary_id: canary.id,
    status: 'status_desconhecido',
    provider: 'local',
    model: 'teste',
    duration_ms: 12
  });
  assert.throws(
    () =>
      service.finishCanary(
        canary.id,
        { action: 'promote', reason: 'Erro observado acima da política configurada.' },
        1
      ),
    (error) => error.code === 'CANARY_TAXA_ERRO_EXCEDIDA'
  );
  const aborted = service.finishCanary(
    canary.id,
    { action: 'abort', reason: 'Canary abortado depois da falha observada.' },
    1
  );
  assert.equal(aborted.status, 'abortado');
  assert.throws(
    () =>
      service.finishCanary(
        canary.id,
        { action: 'abort', reason: 'Canary já finalizado não pode repetir.' },
        1
      ),
    (error) => error.code === 'CANARY_NAO_ENCONTRADO'
  );
  assert.equal(service.listCanaries().length, 1);

  assert.throws(
    () => service.rollbackArtifact(candidate.id, 1, { version: 2 }),
    (error) => error.code === 'ROLLBACK_VERSAO_NAO_PUBLICADA'
  );
  assert.equal(service.rollbackArtifact(candidate.id, null, { version: 1 }).published_version, 1);

  assert.equal(service.getEvaluationSettings().regression_threshold, 5);
  assert.equal(
    service.updateEvaluationSettings({ regression_threshold: 2.5 }, null).regression_threshold,
    2.5
  );
  db.run(
    `INSERT INTO ai_exec_events (provider, model, duration_ms, status, skill_version)
     VALUES ('local', 'modelo-real', 25, 'sucesso', 1)`
  );
  const scorecards = service.llmOpsScorecards();
  assert.equal(scorecards.runtime[0].success_rate, 100);
  assert.ok(scorecards.evaluations.some((item) => item.model === '7'));
  assert.equal(service.listEvaluations(candidate.id, 0).length, 2);
});

test('Centro de ferramentas cobre catálogo idempotente, escopo negado e políticas parciais', async (t) => {
  const { service } = criarContexto(t);
  const seeded = service.ensureToolCatalog([
    { tool_name: 'ler_item', risk_class: 'somente_leitura', read_scopes: ['item'] },
    { tool_name: 'apagar_item', risk_class: 'destrutiva', write_scopes: ['item'], max_calls: 2 },
    { tool_name: 'editar_item', risk_class: 'classe_invalida' }
  ]);
  assert.equal(seeded.created, 3);
  assert.equal(service.ensureToolCatalog([{ tool_name: 'ler_item' }]).created, 0);
  assert.equal(
    service.authorizeToolCall({
      tool_name: 'sem_politica',
      user_id: null,
      operation: 'read',
      scope: null
    }).allowed,
    true
  );
  assert.throws(
    () =>
      service.authorizeToolCall({
        tool_name: 'ler_item',
        user_id: null,
        operation: 'read',
        scope: 'outro'
      }),
    (error) => error.code === 'ESCOPO_FERRAMENTA_NEGADO'
  );
  const edited = service.upsertToolPolicy(
    { tool_name: 'ler_item', description: 'Descrição atualizada sem apagar demais campos.' },
    null
  );
  assert.equal(edited.read_scopes[0], 'item');
  assert.equal(edited.risk_class, 'somente_leitura');
  assert.equal(edited.approval_status, 'pendente');
  assert.throws(
    () => service.decideToolPolicy('inexistente', 'approve', 1, 'Política inexistente.'),
    (error) => error.code === 'POLITICA_NAO_ENCONTRADA'
  );
  assert.equal(service.listToolAudit(0).length, 1);
});

test('MCP cobre OAuth incompleto, cofre externo, revogação e recursos inexistentes', async (t) => {
  const { service } = criarContexto(t);
  const server = service.createMcpServer(
    {
      name: 'MCP OAuth',
      server_url: 'https://mcp.example.com',
      transport: 'streamable_http',
      auth_type: 'oauth2',
      allowlisted: true,
      tools_reviewed: true
    },
    null
  );
  assert.equal(server.credential_reference, 'não configurada');
  assert.throws(
    () =>
      service.decideMcpServer(
        server.id,
        { action: 'approve', rationale: 'OAuth ainda não possui configuração completa.' },
        1
      ),
    (error) => error.code === 'MCP_OAUTH_INCOMPLETO'
  );
  const updated = service.updateMcpServer(
    server.id,
    {
      oauth_issuer: 'https://auth.example.com',
      oauth_client_id: 'kairo-client',
      credential_reference: 'vault://kairo/mcp/oauth',
      requested_scopes: ['agenda.read']
    },
    null
  );
  assert.equal(updated.credential_reference, 'configurada');
  assert.equal(
    service.decideMcpServer(
      server.id,
      { action: 'approve', rationale: 'OAuth e cofre externo revisados integralmente.' },
      null
    ).approval_status,
    'aprovada'
  );
  assert.equal(
    service.decideMcpServer(
      server.id,
      { action: 'revoke', rationale: 'Servidor revogado após revisão administrativa.' },
      null
    ).approval_status,
    'revogada'
  );
  for (const operation of [
    () => service.updateMcpServer(99999, {}, 1),
    () =>
      service.decideMcpServer(
        99999,
        { action: 'revoke', rationale: 'Servidor ausente para decisão.' },
        1
      ),
    () => service.deleteMcpServer(99999, 1)
  ]) {
    assert.throws(operation, (error) => error.code === 'MCP_NAO_ENCONTRADO');
  }
});
