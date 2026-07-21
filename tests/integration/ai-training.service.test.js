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
  const publicado = service.publishArtifact(valido.id, 1);
  assert.equal(publicado.state, 'publicado');
  assert.equal(publicado.published_version, 1);

  // Nova versão publicada e rollback para a anterior.
  service.updateArtifact(
    valido.id,
    { content: 'Nova orientação de decomposição em etapas menores.' },
    1
  );
  service.publishArtifact(valido.id, 1);
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

test('políticas de ferramenta e auditoria registram ações', async (t) => {
  const { service } = criarContexto(t);
  service.upsertToolPolicy(
    {
      tool_name: 'excluir_atividade',
      description: 'Exclui atividade',
      allowed: true,
      requires_confirmation: true,
      destructive: true
    },
    1
  );
  const politicas = service.listToolPolicies();
  assert.equal(politicas.length, 1);
  assert.equal(Number(politicas[0].requires_confirmation), 1);

  const auditoria = service.listAudit();
  assert.ok(auditoria.some((e) => e.action === 'training.tool_policy.upsert'));
});
