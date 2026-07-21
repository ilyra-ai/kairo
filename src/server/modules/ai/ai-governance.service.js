// ============================================================================
// Kairo — Governança de IA 2026 (Tarefa 30)
// ----------------------------------------------------------------------------
// Reúne as capacidades de tendência 2026:
//  - Model Router por privacidade/capacidade/custo (Tendência 1): política
//    versionada que impede envio remoto de dados sensíveis (local-only).
//  - Observabilidade GenAI (Tendência 4): telemetria de execuções — provedor,
//    modelo, duração, tokens, sucesso/erro, tool calls, retrieval — SEM prompt,
//    resposta, argumentos sensíveis ou conteúdo de memória (alinhado ao
//    OpenTelemetry GenAI e ao OWASP LLM Top 10).
//  - Postura para MCP e cofre de chaves permanece descrita como readiness, sem
//    anunciar garantias sem ambiente de execução confiável.
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

export function ensureAiGovernanceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_router_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      sensitive_local_only INTEGER NOT NULL DEFAULT 1 CHECK (sensitive_local_only IN (0, 1)),
      tools_require_capability INTEGER NOT NULL DEFAULT 1 CHECK (tools_require_capability IN (0, 1)),
      fallback_allowed INTEGER NOT NULL DEFAULT 0 CHECK (fallback_allowed IN (0, 1)),
      max_latency_ms INTEGER,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_exec_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      provider TEXT,
      model TEXT,
      purpose TEXT,
      duration_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      tool_calls INTEGER NOT NULL DEFAULT 0,
      retrieved_memories INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'sucesso',
      skill_version INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
      -- NUNCA guarda prompt, resposta, argumentos ou conteúdo de memória.
    );
  `);
}

const DECISION_LOCAL = 'local';
const DECISION_REMOTE = 'remoto';

export function createAiGovernanceService({ db } = {}) {
  if (!db) throw new Error('A governança de IA exige uma instância de banco de dados.');
  ensureAiGovernanceSchema(db);

  function getRouterPolicy() {
    let row = db.get(
      'SELECT * FROM ai_router_policies WHERE active = 1 ORDER BY version DESC LIMIT 1'
    );
    if (!row) {
      db.run(
        'INSERT INTO ai_router_policies (version, sensitive_local_only, tools_require_capability, fallback_allowed) VALUES (1, 1, 1, 0)'
      );
      row = db.get(
        'SELECT * FROM ai_router_policies WHERE active = 1 ORDER BY version DESC LIMIT 1'
      );
    }
    return {
      version: row.version,
      sensitive_local_only: Boolean(row.sensitive_local_only),
      tools_require_capability: Boolean(row.tools_require_capability),
      fallback_allowed: Boolean(row.fallback_allowed),
      max_latency_ms: row.max_latency_ms
    };
  }

  // Atualiza a política criando uma NOVA versão (versionamento real).
  function updateRouterPolicy(input, actorUserId) {
    const atual = getRouterPolicy();
    const novaVersao = atual.version + 1;
    db.transaction(() => {
      db.run('UPDATE ai_router_policies SET active = 0');
      db.run(
        `INSERT INTO ai_router_policies
          (version, sensitive_local_only, tools_require_capability, fallback_allowed, max_latency_ms, active, updated_by)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [
          novaVersao,
          (input.sensitive_local_only ?? atual.sensitive_local_only) ? 1 : 0,
          (input.tools_require_capability ?? atual.tools_require_capability) ? 1 : 0,
          (input.fallback_allowed ?? atual.fallback_allowed) ? 1 : 0,
          input.max_latency_ms ?? atual.max_latency_ms ?? null,
          actorUserId ?? null
        ]
      );
    });
    return getRouterPolicy();
  }

  /**
   * Decisão de roteamento por privacidade/capacidade. Impede envio remoto de
   * dados sensíveis quando a política for local-only. Não escolhe o modelo em
   * si (isso é do gateway), mas define o destino permitido e o motivo.
   *
   * @param {object} req { sensitive:boolean, needsTools:boolean, isLocalAvailable:boolean, isRemoteAvailable:boolean }
   */
  function decideRoute(req = {}) {
    const policy = getRouterPolicy();
    const sensitive = Boolean(req.sensitive);
    const localDisponivel = Boolean(req.isLocalAvailable);
    const remotoDisponivel = Boolean(req.isRemoteAvailable);

    if (sensitive && policy.sensitive_local_only) {
      if (!localDisponivel) {
        throw unprocessable(
          'A política exige processamento local para dados sensíveis, mas não há modelo local disponível.',
          'ROTA_LOCAL_INDISPONIVEL'
        );
      }
      return {
        decision: DECISION_LOCAL,
        reason: 'Dados sensíveis: política local-only.',
        policy_version: policy.version
      };
    }
    if (localDisponivel) {
      return {
        decision: DECISION_LOCAL,
        reason: 'Preferência por processamento local.',
        policy_version: policy.version
      };
    }
    if (remotoDisponivel && (!sensitive || policy.fallback_allowed)) {
      return {
        decision: DECISION_REMOTE,
        reason: 'Modelo local indisponível; remoto permitido.',
        policy_version: policy.version
      };
    }
    throw unprocessable('Nenhuma rota permitida pela política atual.', 'SEM_ROTA_PERMITIDA');
  }

  // --------------------------------------------------------------------------
  // Observabilidade GenAI — registra execução SEM conteúdo
  // --------------------------------------------------------------------------
  function recordExecution(event = {}) {
    db.run(
      `INSERT INTO ai_exec_events
        (user_id, provider, model, purpose, duration_ms, input_tokens, output_tokens, tool_calls, retrieved_memories, status, skill_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.user_id ?? null,
        event.provider ?? null,
        event.model ?? null,
        event.purpose ?? null,
        event.duration_ms ?? null,
        event.input_tokens ?? null,
        event.output_tokens ?? null,
        event.tool_calls ?? 0,
        event.retrieved_memories ?? 0,
        event.status ?? 'sucesso',
        event.skill_version ?? null
      ]
    );
    return { recorded: true };
  }

  function observability({ from = null, to = null } = {}) {
    const cl = [];
    const params = [];
    if (from) {
      cl.push('created_at >= ?');
      params.push(from);
    }
    if (to) {
      cl.push('created_at <= ?');
      params.push(to);
    }
    const where = cl.length ? `WHERE ${cl.join(' AND ')}` : '';
    const resumo = db.get(
      `SELECT COUNT(*) AS total,
              COALESCE(AVG(duration_ms), 0) AS avg_duration,
              SUM(CASE WHEN status = 'erro' THEN 1 ELSE 0 END) AS errors,
              SUM(CASE WHEN status = 'cancelado' THEN 1 ELSE 0 END) AS canceled,
              COALESCE(SUM(tool_calls), 0) AS tool_calls,
              COALESCE(SUM(retrieved_memories), 0) AS retrievals,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM ai_exec_events ${where}`,
      params
    );
    const porModelo = db.all(
      `SELECT provider, model, COUNT(*) AS total, COALESCE(AVG(duration_ms), 0) AS avg_duration
       FROM ai_exec_events ${where} GROUP BY provider, model ORDER BY total DESC LIMIT 20`,
      params
    );
    return { summary: resumo, by_model: porModelo };
  }

  return {
    ensureSchema: () => ensureAiGovernanceSchema(db),
    getRouterPolicy,
    updateRouterPolicy,
    decideRoute,
    recordExecution,
    observability
  };
}
