// ============================================================================
// Kairo — Estúdio de Treinamento governado de IA (Tarefa 27)
// ----------------------------------------------------------------------------
// "Treinamento" aqui significa CONFIGURAÇÃO GOVERNADA de comportamento e
// conhecimento (instruções de sistema, workflows, skills, políticas, exemplos
// e bases curadas), com CRUD real, versionamento, avaliação determinística,
// pipeline de publicação atômica, rollback e auditoria — nunca fine-tuning
// silencioso. O pacote inicial de competências é semeado uma única vez, de
// forma versionada e editável (jamais hardcode espalhado pelo código).
// ============================================================================

import { conflict, notFound, unprocessable } from '../../shared/http-error.js';

export const ARTIFACT_TYPES = Object.freeze([
  'instrucao_sistema',
  'workflow',
  'skill',
  'politica_seguranca',
  'politica_privacidade',
  'modelo_resposta',
  'exemplo_aprovado',
  'regra_ferramenta',
  'base_conhecimento'
]);

export const ARTIFACT_SCOPES = Object.freeze(['global', 'plano', 'funcionalidade', 'perfil']);
export const ARTIFACT_STATES = Object.freeze(['rascunho', 'em_teste', 'publicado', 'arquivado']);

const SEED_MARK = 'kairo-competencias-iniciais-v1';

export function ensureAiTrainingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_training_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'global',
      scope_ref TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      allowed_data TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT 'rascunho',
      current_version INTEGER NOT NULL DEFAULT 1,
      published_version INTEGER,
      author_id INTEGER,
      approver_id INTEGER,
      changelog TEXT NOT NULL DEFAULT '',
      seed_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL,
      FOREIGN KEY (approver_id) REFERENCES users (id) ON DELETE SET NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_training_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      changelog TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'rascunho',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (artifact_id, version),
      FOREIGN KEY (artifact_id) REFERENCES ai_training_artifacts (id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_training_dependencies (
      artifact_id INTEGER NOT NULL,
      depends_on_id INTEGER NOT NULL,
      PRIMARY KEY (artifact_id, depends_on_id),
      FOREIGN KEY (artifact_id) REFERENCES ai_training_artifacts (id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_id) REFERENCES ai_training_artifacts (id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      published_by INTEGER,
      published_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (artifact_id) REFERENCES ai_training_artifacts (id) ON DELETE CASCADE,
      FOREIGN KEY (published_by) REFERENCES users (id) ON DELETE SET NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_tool_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0, 1)),
      requires_confirmation INTEGER NOT NULL DEFAULT 1 CHECK (requires_confirmation IN (0, 1)),
      destructive INTEGER NOT NULL DEFAULT 0 CHECK (destructive IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      artifact_id INTEGER,
      version INTEGER,
      actor_id INTEGER,
      decision TEXT,
      result TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Pacote inicial obrigatório de competências (semeado uma única vez)
// ----------------------------------------------------------------------------
const COMPETENCIAS_INICIAIS = Object.freeze([
  {
    name: 'Idioma e comunicação (pt-BR)',
    type: 'instrucao_sistema',
    priority: 10,
    description: 'Diretrizes de idioma, tom e clareza.',
    content:
      'Responda sempre em português do Brasil. Seja claro, acolhedor e objetivo. ' +
      'Adapte a profundidade ao usuário. Nunca invente conclusão, dado ou execução.'
  },
  {
    name: 'Domínio Kairo',
    type: 'base_conhecimento',
    priority: 20,
    description: 'Conhecimento do produto Kairo.',
    content:
      'Domine: agenda e seus sete layouts; atividades e categorias; metas e períodos; ' +
      'Pomodoro e foco; carga cognitiva, prioridade e energia; relatórios; recompensas e ' +
      'Dopamenu; perfil e preferências.'
  },
  {
    name: 'Planejamento de tarefas',
    type: 'skill',
    priority: 30,
    description: 'Como planejar e decompor tarefas.',
    content:
      'Decomponha tarefas grandes; sugira a próxima ação; estime com incerteza explícita; ' +
      'identifique dependências; evite sobrecarga; recomende blocos de foco.'
  },
  {
    name: 'TDAH e acessibilidade cognitiva',
    type: 'politica_seguranca',
    priority: 30,
    description: 'Boas práticas para acessibilidade cognitiva.',
    content:
      'Use instruções curtas e acionáveis; reduza ambiguidade; ofereça micro-passos; ' +
      'apresente alternativas de baixa energia; use linguagem não estigmatizante; ' +
      'nunca realize diagnóstico médico.'
  },
  {
    name: 'Uso seguro de ferramentas',
    type: 'regra_ferramenta',
    priority: 5,
    description: 'Regras de uso de ferramentas com confirmação humana.',
    content:
      'Leitura pode ser automática conforme permissão; criação e edição mostram prévia quando ' +
      'houver ambiguidade; exclusão, alteração em massa, pagamento, conta e memória exigem ' +
      'confirmação explícita; valide argumentos no servidor; respeite o proprietário do recurso.'
  },
  {
    name: 'Privacidade',
    type: 'politica_privacidade',
    priority: 5,
    description: 'Princípios de privacidade e minimização.',
    content:
      'Colete o mínimo; não revele memória; não inclua dados sensíveis em logs; respeite limpeza, ' +
      'exclusão, retenção e consentimento; não infira dado sensível desnecessário.'
  },
  {
    name: 'Honestidade operacional',
    type: 'politica_seguranca',
    priority: 5,
    description: 'Diferenciar sugestão de ação executada.',
    content:
      'Diferencie sugestão de ação executada; confirme o resultado real da API; informe falhas sem ' +
      'fingir sucesso; nunca prometa persistência sem confirmação do banco.'
  },
  {
    name: 'Qualidade textual',
    type: 'modelo_resposta',
    priority: 40,
    description: 'Padrões de qualidade textual.',
    content:
      'Cuide de ortografia, gramática e clareza; preserve a intenção do usuário; use títulos ' +
      'acionáveis; escreva descrições com resultado esperado e critério de conclusão.'
  }
]);

export function createAiTrainingService({ db, now = () => new Date() } = {}) {
  if (!db) throw new Error('O Estúdio de Treinamento exige uma instância de banco de dados.');
  ensureAiTrainingSchema(db);

  function registrarAuditoria({ action, artifactId, version, actorId, decision, result, detail }) {
    db.run(
      `INSERT INTO ai_audit_events (action, artifact_id, version, actor_id, decision, result, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        action,
        artifactId ?? null,
        version ?? null,
        actorId ?? null,
        decision ?? null,
        result,
        detail ? String(detail).slice(0, 500) : null
      ]
    );
  }

  function serialize(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      content: row.content,
      scope: row.scope,
      scope_ref: row.scope_ref,
      priority: row.priority,
      allowed_tools: jsonArray(row.allowed_tools),
      allowed_data: jsonArray(row.allowed_data),
      state: row.state,
      current_version: row.current_version,
      published_version: row.published_version,
      author_id: row.author_id,
      approver_id: row.approver_id,
      changelog: row.changelog,
      is_seed: Boolean(row.seed_key),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  function obterArtefato(id) {
    const row = db.get('SELECT * FROM ai_training_artifacts WHERE id = ?', [id]);
    if (!row) throw notFound('Artefato de treinamento não encontrado.', 'ARTEFATO_NAO_ENCONTRADO');
    return row;
  }

  function validarTipoEscopo(type, scope) {
    if (!ARTIFACT_TYPES.includes(type)) {
      throw unprocessable('Tipo de artefato inválido.', 'TIPO_ARTEFATO_INVALIDO');
    }
    if (scope && !ARTIFACT_SCOPES.includes(scope)) {
      throw unprocessable('Escopo de artefato inválido.', 'ESCOPO_INVALIDO');
    }
  }

  function listArtifacts(filter = {}) {
    const clausulas = [];
    const params = [];
    if (filter.type) {
      clausulas.push('type = ?');
      params.push(filter.type);
    }
    if (filter.state) {
      clausulas.push('state = ?');
      params.push(filter.state);
    }
    const where = clausulas.length ? `WHERE ${clausulas.join(' AND ')}` : '';
    return db
      .all(`SELECT * FROM ai_training_artifacts ${where} ORDER BY priority ASC, id ASC`, params)
      .map(serialize);
  }

  function getArtifact(id) {
    return serialize(obterArtefato(id));
  }

  function createArtifact(input, actorId, { seedKey = null } = {}) {
    validarTipoEscopo(input.type, input.scope);
    const criado = db.transaction(() => {
      const result = db.run(
        `INSERT INTO ai_training_artifacts
          (name, type, description, content, scope, scope_ref, priority, allowed_tools, allowed_data,
           state, current_version, author_id, changelog, seed_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', 1, ?, ?, ?)`,
        [
          input.name,
          input.type,
          input.description ?? '',
          input.content ?? '',
          input.scope ?? 'global',
          input.scope_ref ?? null,
          input.priority ?? 100,
          JSON.stringify(input.allowed_tools ?? []),
          JSON.stringify(input.allowed_data ?? []),
          actorId ?? null,
          input.changelog ?? 'Versão inicial.',
          seedKey
        ]
      );
      const id = result.lastID;
      db.run(
        `INSERT INTO ai_training_versions (artifact_id, version, content, description, changelog, state, created_by)
         VALUES (?, 1, ?, ?, ?, 'rascunho', ?)`,
        [
          id,
          input.content ?? '',
          input.description ?? '',
          input.changelog ?? 'Versão inicial.',
          actorId ?? null
        ]
      );
      return db.get('SELECT * FROM ai_training_artifacts WHERE id = ?', [id]);
    });
    registrarAuditoria({
      action: 'training.artifact.create',
      artifactId: criado.id,
      version: 1,
      actorId,
      result: 'sucesso'
    });
    return serialize(criado);
  }

  // Editar cria uma NOVA versão (versionamento real), mantendo histórico.
  function updateArtifact(id, input, actorId) {
    const atual = obterArtefato(id);
    if (input.type || input.scope)
      validarTipoEscopo(input.type ?? atual.type, input.scope ?? atual.scope);
    const novaVersao = atual.current_version + 1;
    const content = input.content ?? atual.content;
    const description = input.description ?? atual.description;
    const changelog = input.changelog ?? `Edição para a versão ${novaVersao}.`;

    const atualizado = db.transaction(() => {
      db.run(
        `UPDATE ai_training_artifacts
         SET name = ?, type = ?, description = ?, content = ?, scope = ?, scope_ref = ?, priority = ?,
             allowed_tools = ?, allowed_data = ?, current_version = ?, changelog = ?,
             state = CASE WHEN state = 'publicado' THEN 'em_teste' ELSE state END,
             updated_at = datetime('now')
         WHERE id = ?`,
        [
          input.name ?? atual.name,
          input.type ?? atual.type,
          description,
          content,
          input.scope ?? atual.scope,
          input.scope_ref ?? atual.scope_ref,
          input.priority ?? atual.priority,
          JSON.stringify(input.allowed_tools ?? jsonArray(atual.allowed_tools)),
          JSON.stringify(input.allowed_data ?? jsonArray(atual.allowed_data)),
          novaVersao,
          changelog,
          id
        ]
      );
      db.run(
        `INSERT INTO ai_training_versions (artifact_id, version, content, description, changelog, state, created_by)
         VALUES (?, ?, ?, ?, ?, 'rascunho', ?)`,
        [id, novaVersao, content, description, changelog, actorId ?? null]
      );
      return db.get('SELECT * FROM ai_training_artifacts WHERE id = ?', [id]);
    });
    registrarAuditoria({
      action: 'training.artifact.update',
      artifactId: id,
      version: novaVersao,
      actorId,
      result: 'sucesso'
    });
    return serialize(atualizado);
  }

  function duplicateArtifact(id, actorId) {
    const origem = obterArtefato(id);
    return createArtifact(
      {
        name: `${origem.name} (cópia)`,
        type: origem.type,
        description: origem.description,
        content: origem.content,
        scope: origem.scope,
        scope_ref: origem.scope_ref,
        priority: origem.priority,
        allowed_tools: jsonArray(origem.allowed_tools),
        allowed_data: jsonArray(origem.allowed_data),
        changelog: `Duplicado do artefato #${id}.`
      },
      actorId
    );
  }

  function listVersions(id) {
    obterArtefato(id);
    return db.all(
      'SELECT id, version, description, changelog, state, created_by, created_at FROM ai_training_versions WHERE artifact_id = ? ORDER BY version DESC',
      [id]
    );
  }

  function archiveArtifact(id, actorId) {
    obterArtefato(id);
    db.run(
      "UPDATE ai_training_artifacts SET state = 'arquivado', updated_at = datetime('now') WHERE id = ?",
      [id]
    );
    db.run('UPDATE ai_deployments SET active = 0 WHERE artifact_id = ?', [id]);
    registrarAuditoria({
      action: 'training.artifact.archive',
      artifactId: id,
      actorId,
      result: 'sucesso'
    });
    return getArtifact(id);
  }

  function restoreArtifact(id, actorId) {
    obterArtefato(id);
    db.run(
      "UPDATE ai_training_artifacts SET state = 'rascunho', updated_at = datetime('now') WHERE id = ? AND state = 'arquivado'",
      [id]
    );
    registrarAuditoria({
      action: 'training.artifact.restore',
      artifactId: id,
      actorId,
      result: 'sucesso'
    });
    return getArtifact(id);
  }

  function deleteArtifact(id, actorId) {
    const artefato = obterArtefato(id);
    if (artefato.seed_key) {
      throw conflict(
        'Competências do pacote inicial não podem ser excluídas; arquive-as se necessário.',
        'ARTEFATO_SEED_PROTEGIDO'
      );
    }
    const referenciado = db.get(
      'SELECT 1 AS found FROM ai_training_dependencies WHERE depends_on_id = ?',
      [id]
    );
    if (referenciado) {
      throw conflict(
        'O artefato é referenciado por outro e não pode ser excluído.',
        'ARTEFATO_REFERENCIADO'
      );
    }
    db.run('DELETE FROM ai_training_artifacts WHERE id = ?', [id]);
    registrarAuditoria({
      action: 'training.artifact.delete',
      artifactId: id,
      actorId,
      result: 'sucesso'
    });
  }

  // --------------------------------------------------------------------------
  // Avaliação determinística real (sem depender de LLM) — porta de qualidade
  // --------------------------------------------------------------------------
  function evaluateArtifact(id) {
    const artefato = obterArtefato(id);
    const checagens = [];
    const conteudo = String(artefato.content || '');

    checagens.push({
      nome: 'conteudo_nao_vazio',
      ok: conteudo.trim().length >= 10,
      detalhe: 'O conteúdo deve ter ao menos 10 caracteres.'
    });
    checagens.push({
      nome: 'sem_placeholder',
      ok: !/(TODO|FIXME|lorem ipsum|placeholder|xxxxx)/i.test(conteudo),
      detalhe: 'O conteúdo não pode conter placeholders.'
    });
    checagens.push({
      nome: 'tamanho_seguro',
      ok: conteudo.length <= 8000,
      detalhe: 'O conteúdo não pode exceder 8000 caracteres.'
    });
    // Regras de ferramenta e políticas devem citar confirmação humana em ações sensíveis.
    if (artefato.type === 'regra_ferramenta') {
      checagens.push({
        nome: 'confirmacao_humana',
        ok: /confirma/i.test(conteudo),
        detalhe: 'Regras de ferramenta devem exigir confirmação humana em ações sensíveis.'
      });
    }
    // Dependências devem existir.
    const deps = db.all(
      'SELECT depends_on_id FROM ai_training_dependencies WHERE artifact_id = ?',
      [id]
    );
    const depsOk = deps.every((d) =>
      db.get('SELECT 1 AS found FROM ai_training_artifacts WHERE id = ?', [d.depends_on_id])
    );
    checagens.push({
      nome: 'dependencias_resolvidas',
      ok: depsOk,
      detalhe: 'Todas as dependências declaradas devem existir.'
    });

    const aprovado = checagens.every((c) => c.ok);
    db.run(
      "UPDATE ai_training_artifacts SET state = CASE WHEN ? THEN 'em_teste' ELSE state END, updated_at = datetime('now') WHERE id = ? AND state = 'rascunho'",
      [aprovado ? 1 : 0, id]
    );
    registrarAuditoria({
      action: 'training.artifact.evaluate',
      artifactId: id,
      version: artefato.current_version,
      decision: aprovado ? 'aprovado' : 'reprovado',
      result: aprovado ? 'sucesso' : 'falha'
    });
    return { artifact_id: id, approved: aprovado, checks: checagens };
  }

  // Publicação atômica: exige avaliação aprovada; cria deployment ativo.
  function publishArtifact(id, actorId) {
    const artefato = obterArtefato(id);
    const avaliacao = evaluateArtifact(id);
    if (!avaliacao.approved) {
      registrarAuditoria({
        action: 'training.artifact.publish',
        artifactId: id,
        actorId,
        decision: 'bloqueado',
        result: 'falha',
        detail: 'Avaliação reprovada.'
      });
      throw unprocessable(
        'O artefato não passou na avaliação e não pode ser publicado.',
        'AVALIACAO_REPROVADA'
      );
    }
    const publicado = db.transaction(() => {
      db.run('UPDATE ai_deployments SET active = 0 WHERE artifact_id = ?', [id]);
      db.run(
        'INSERT INTO ai_deployments (artifact_id, version, active, published_by) VALUES (?, ?, 1, ?)',
        [id, artefato.current_version, actorId ?? null]
      );
      db.run(
        "UPDATE ai_training_artifacts SET state = 'publicado', published_version = ?, approver_id = ?, updated_at = datetime('now') WHERE id = ?",
        [artefato.current_version, actorId ?? null, id]
      );
      return db.get('SELECT * FROM ai_training_artifacts WHERE id = ?', [id]);
    });
    registrarAuditoria({
      action: 'training.artifact.publish',
      artifactId: id,
      version: artefato.current_version,
      actorId,
      decision: 'aprovado',
      result: 'sucesso'
    });
    return serialize(publicado);
  }

  // Rollback imediato para a versão publicada anterior.
  function rollbackArtifact(id, actorId) {
    obterArtefato(id);
    const anterior = db.get(
      `SELECT version FROM ai_deployments WHERE artifact_id = ? AND active = 0 ORDER BY published_at DESC LIMIT 1`,
      [id]
    );
    if (!anterior) {
      throw conflict('Não há versão anterior publicada para reverter.', 'SEM_VERSAO_ANTERIOR');
    }
    const revertido = db.transaction(() => {
      db.run('UPDATE ai_deployments SET active = 0 WHERE artifact_id = ?', [id]);
      db.run(
        'INSERT INTO ai_deployments (artifact_id, version, active, published_by) VALUES (?, ?, 1, ?)',
        [id, anterior.version, actorId ?? null]
      );
      db.run(
        "UPDATE ai_training_artifacts SET state = 'publicado', published_version = ?, updated_at = datetime('now') WHERE id = ?",
        [anterior.version, id]
      );
      return db.get('SELECT * FROM ai_training_artifacts WHERE id = ?', [id]);
    });
    registrarAuditoria({
      action: 'training.artifact.rollback',
      artifactId: id,
      version: anterior.version,
      actorId,
      decision: 'revertido',
      result: 'sucesso'
    });
    return serialize(revertido);
  }

  // --------------------------------------------------------------------------
  // Contexto ativo do modelo: composição das competências publicadas.
  // Alterações publicadas passam a valer sem reiniciar o servidor (lê do banco).
  // --------------------------------------------------------------------------
  function activeContext() {
    const linhas = db.all(`
      SELECT a.id, a.name, a.type, a.priority, v.content
      FROM ai_deployments d
      INNER JOIN ai_training_artifacts a ON a.id = d.artifact_id
      INNER JOIN ai_training_versions v ON v.artifact_id = a.id AND v.version = d.version
      WHERE d.active = 1 AND a.state = 'publicado'
      ORDER BY a.priority ASC, a.id ASC
    `);
    return linhas.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      priority: l.priority,
      content: l.content
    }));
  }

  // --------------------------------------------------------------------------
  // Políticas de ferramenta (allowlist + confirmação humana)
  // --------------------------------------------------------------------------
  function listToolPolicies() {
    return db.all('SELECT * FROM ai_tool_policies ORDER BY tool_name ASC');
  }

  function upsertToolPolicy(input, actorId) {
    db.run(
      `INSERT INTO ai_tool_policies (tool_name, description, allowed, requires_confirmation, destructive, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(tool_name) DO UPDATE SET
         description = excluded.description,
         allowed = excluded.allowed,
         requires_confirmation = excluded.requires_confirmation,
         destructive = excluded.destructive,
         updated_at = datetime('now')`,
      [
        input.tool_name,
        input.description ?? '',
        input.allowed ? 1 : 0,
        input.requires_confirmation ? 1 : 0,
        input.destructive ? 1 : 0
      ]
    );
    registrarAuditoria({
      action: 'training.tool_policy.upsert',
      actorId,
      result: 'sucesso',
      detail: input.tool_name
    });
    return db.get('SELECT * FROM ai_tool_policies WHERE tool_name = ?', [input.tool_name]);
  }

  function listAudit(limit = 100) {
    const max = Math.max(1, Math.min(500, Number(limit) || 100));
    return db.all('SELECT * FROM ai_audit_events ORDER BY id DESC LIMIT ?', [max]);
  }

  // --------------------------------------------------------------------------
  // Seed idempotente do pacote inicial de competências (uma única vez)
  // --------------------------------------------------------------------------
  function ensureSeedCompetencies(actorId = null) {
    const jaSemeado = db.get('SELECT 1 AS found FROM ai_training_artifacts WHERE seed_key = ?', [
      SEED_MARK
    ]);
    if (jaSemeado) return { seeded: false };
    let criadas = 0;
    for (const competencia of COMPETENCIAS_INICIAIS) {
      const existe = db.get(
        'SELECT 1 AS found FROM ai_training_artifacts WHERE name = ? AND seed_key IS NOT NULL',
        [competencia.name]
      );
      if (existe) continue;
      const artefato = createArtifact(
        { ...competencia, scope: 'global', changelog: 'Competência inicial semeada.' },
        actorId,
        { seedKey: SEED_MARK }
      );
      // Publica automaticamente a competência inicial (passa pela porta de avaliação).
      publishArtifact(artefato.id, actorId);
      criadas += 1;
    }
    registrarAuditoria({
      action: 'training.seed_competencies',
      actorId,
      result: 'sucesso',
      detail: `${criadas} competências`
    });
    return { seeded: true, count: criadas };
  }

  return {
    ensureSchema: () => ensureAiTrainingSchema(db),
    listArtifacts,
    getArtifact,
    createArtifact,
    updateArtifact,
    duplicateArtifact,
    listVersions,
    archiveArtifact,
    restoreArtifact,
    deleteArtifact,
    evaluateArtifact,
    publishArtifact,
    rollbackArtifact,
    activeContext,
    listToolPolicies,
    upsertToolPolicy,
    listAudit,
    ensureSeedCompetencies,
    _now: now
  };
}
