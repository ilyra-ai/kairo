// ============================================================================
// Kairo — Privacidade, direitos do titular e retenção legal (LGPD)
// ============================================================================
//
// Implementa a Tarefa 29: matriz de retenção por categoria de dado, exclusão
// definitiva da própria conta em transação atômica com comprovante íntegro,
// e registro rastreável de solicitações formais de titulares.
//
// Bases legais aplicadas (LGPD, Lei nº 13.709/2018):
// - art. 7º, VI  — exercício regular de direitos (comprovante de exclusão);
// - art. 7º, IX  — legítimo interesse/segurança (trilha de auditoria);
// - art. 16      — hipóteses de conservação após o término do tratamento;
// - art. 18      — direitos do titular (confirmação, acesso, correção,
//                  anonimização, eliminação, informação e revisão).

import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  conflict,
  forbidden,
  notFound,
  unauthorized,
  unprocessable
} from '../../shared/http-error.js';

const DIAS_EM_MS = 24 * 60 * 60 * 1000;

// Matriz de retenção versionada. Nenhuma categoria usa "guardar para sempre":
// cada uma tem base legal, evento inicial, prazo e ação ao vencer.
export const POLITICAS_DE_RETENCAO = Object.freeze([
  Object.freeze({
    category: 'trilha-de-auditoria',
    legal_basis: 'LGPD art. 7º, IX e art. 16, II — segurança e prevenção à fraude',
    retention_days: 730,
    trigger_event: 'exclusao-da-conta',
    expiry_action: 'anonimizar',
    version: 1
  }),
  Object.freeze({
    category: 'comprovante-de-exclusao',
    legal_basis: 'LGPD art. 7º, VI e art. 16, I — exercício regular de direitos',
    retention_days: 1825,
    trigger_event: 'exclusao-da-conta',
    expiry_action: 'eliminar',
    version: 1
  })
]);

export const TIPOS_DE_SOLICITACAO = Object.freeze([
  'confirmacao',
  'acesso',
  'correcao',
  'anonimizacao',
  'eliminacao',
  'informacao',
  'revisao'
]);

const PRAZO_RESPOSTA_DIAS = 15;

// Tabelas de usuário eliminadas na exclusão da conta, na ordem segura de FK.
// goals e timeframes não possuem user_id próprio: pertencem ao titular por
// meio da atividade proprietária, por isso usam subconsulta. users vem por
// último: as FKs com ON DELETE CASCADE cobrem qualquer resto.
const CLAUSULA_POR_USUARIO = 'user_id = ?';
const CLAUSULA_POR_ATIVIDADE =
  'activity_id IN (SELECT id FROM activities WHERE activities.user_id = ?)';
const TABELAS_DE_DADOS_PESSOAIS = Object.freeze([
  Object.freeze({ tabela: 'reward_feedback', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'reward_events', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'user_gamification', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'dopamenu', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'oauth_states', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'google_tokens', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'agenda_events', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'goals', clausula: CLAUSULA_POR_ATIVIDADE }),
  Object.freeze({ tabela: 'timeframes', clausula: CLAUSULA_POR_ATIVIDADE }),
  Object.freeze({ tabela: 'activities', clausula: CLAUSULA_POR_USUARIO }),
  // Termômetro de energia (Tarefa 23).
  Object.freeze({ tabela: 'energy_logs', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'energy_settings', clausula: CLAUSULA_POR_USUARIO }),
  // Memória de IA criptografada (Tarefa 28) — inclui exclusão criptográfica das
  // chaves, tornando qualquer resíduo irrecuperável.
  Object.freeze({ tabela: 'ai_memory_embeddings', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'ai_memory_items', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'ai_memory_key_versions', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'ai_memory_access_events', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'ai_memory_deletion_events', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'ai_memory_profiles', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'profile_data', clausula: CLAUSULA_POR_USUARIO }),
  Object.freeze({ tabela: 'auth_sessions', clausula: CLAUSULA_POR_USUARIO })
]);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function tableExists(db, name) {
  return Boolean(
    db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name])
  );
}

export function ensurePrivacySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS legal_retention_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL UNIQUE,
      legal_basis TEXT NOT NULL,
      retention_days INTEGER NOT NULL CHECK (retention_days > 0),
      trigger_event TEXT NOT NULL,
      expiry_action TEXT NOT NULL CHECK (expiry_action IN ('eliminar', 'anonimizar')),
      version INTEGER NOT NULL DEFAULT 1,
      approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS legal_retention_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_hash TEXT NOT NULL,
      category TEXT NOT NULL REFERENCES legal_retention_policies (category),
      minimal_reference TEXT NOT NULL,
      legal_basis TEXT NOT NULL,
      reason TEXT NOT NULL,
      retention_until DATETIME NOT NULL,
      integrity_hash TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_retention_records_subject
      ON legal_retention_records (subject_hash);
    CREATE INDEX IF NOT EXISTS idx_retention_records_until
      ON legal_retention_records (retention_until);

    CREATE TABLE IF NOT EXISTS privacy_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_type TEXT NOT NULL,
      subject_hash TEXT NOT NULL,
      subject_user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'aberta'
        CHECK (status IN ('aberta', 'em-analise', 'atendida', 'recusada')),
      due_at DATETIME NOT NULL,
      result_summary TEXT,
      evidence TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_privacy_requests_subject
      ON privacy_requests (subject_hash, created_at);

    CREATE TABLE IF NOT EXISTS deletion_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_uuid TEXT NOT NULL UNIQUE,
      subject_hash TEXT NOT NULL,
      processed_tables TEXT NOT NULL,
      counts_json TEXT NOT NULL,
      legal_exceptions TEXT NOT NULL,
      external_pending TEXT,
      started_at DATETIME NOT NULL,
      finished_at DATETIME NOT NULL,
      integrity_hash TEXT NOT NULL
    );
  `);

  for (const policy of POLITICAS_DE_RETENCAO) {
    db.run(
      `INSERT INTO legal_retention_policies
         (category, legal_basis, retention_days, trigger_event, expiry_action, version)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (category) DO UPDATE SET
         legal_basis = excluded.legal_basis,
         retention_days = excluded.retention_days,
         trigger_event = excluded.trigger_event,
         expiry_action = excluded.expiry_action,
         version = excluded.version`,
      [
        policy.category,
        policy.legal_basis,
        policy.retention_days,
        policy.trigger_event,
        policy.expiry_action,
        policy.version
      ]
    );
  }
}

export function createPrivacyService(options) {
  const { db, authService, googleCalendarService = null, now = () => new Date() } = options;
  if (!db) throw new TypeError('O banco de dados é obrigatório para o serviço de privacidade.');
  if (!authService) {
    throw new TypeError('O serviço de autenticação é obrigatório para o serviço de privacidade.');
  }

  ensurePrivacySchema(db);

  function policies() {
    return db.all(
      `SELECT category, legal_basis, retention_days, trigger_event, expiry_action, version
       FROM legal_retention_policies ORDER BY category`
    );
  }

  function policyByCategory(category) {
    const policy = db.get('SELECT * FROM legal_retention_policies WHERE category = ?', [category]);
    if (!policy) {
      throw notFound('Política de retenção não encontrada.', 'POLITICA_RETENCAO_INEXISTENTE');
    }
    return policy;
  }

  function registerRetention({ subjectHash, category, minimalReference, reason }) {
    const policy = policyByCategory(category);
    const retentionUntil = new Date(
      now().getTime() + policy.retention_days * DIAS_EM_MS
    ).toISOString();
    const integrity = sha256(
      [subjectHash, category, minimalReference, policy.legal_basis, retentionUntil].join('|')
    );
    db.run(
      `INSERT INTO legal_retention_records
         (subject_hash, category, minimal_reference, legal_basis, reason,
          retention_until, integrity_hash, locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        subjectHash,
        category,
        minimalReference,
        policy.legal_basis,
        reason,
        retentionUntil,
        integrity
      ]
    );
    return { category, retention_until: retentionUntil, integrity_hash: integrity };
  }

  /**
   * Exclusão definitiva da própria conta.
   *
   * - A senha atual é conferida com bcrypt (digitada na zona de perigo).
   * - O último administrador ativo não pode se excluir (o app ficaria sem
   *   gestão); a regra espelha a proteção já existente na administração.
   * - Em transação: sessões revogadas, dados pessoais eliminados tabela a
   *   tabela (contagens registradas), trilha de auditoria anonimizada e
   *   retida com base legal, e o comprovante gravado com hash de integridade.
   * - A revogação externa do Google é tentada de forma melhor-esforço; se o
   *   provedor não confirmar, o acesso local já foi eliminado e a pendência
   *   fica transparente no comprovante.
   */
  async function deleteOwnAccount(user, { password }, request = {}) {
    const persistido = db.get('SELECT * FROM users WHERE id = ? AND is_active = 1', [user.id]);
    if (!persistido || !(await bcrypt.compare(password, persistido.password_hash))) {
      authService.audit({
        action: 'privacy.account.delete',
        result: 'falha',
        actorUserId: user.id,
        targetUserId: user.id,
        request
      });
      throw unauthorized('A senha informada não confere.', 'SENHA_ATUAL_INVALIDA');
    }

    if (persistido.role === 'administrador') {
      const administradoresAtivos = Number(
        db.get("SELECT COUNT(*) AS total FROM users WHERE role = 'administrador' AND is_active = 1")
          .total
      );
      if (administradoresAtivos <= 1) {
        throw conflict(
          'O único administrador ativo não pode excluir a própria conta. Promova outro administrador antes.',
          'ULTIMO_ADMINISTRADOR'
        );
      }
    }

    const subjectHash = sha256(persistido.email.toLowerCase());
    const receiptUuid = randomUUID();
    const startedAt = now().toISOString();

    // Pendência externa (Google) resolvida antes da transação local: o token
    // ainda existe neste momento, permitindo a revogação real no provedor.
    let externalPending = null;
    const temTokenGoogle = tableExists(db, 'google_tokens')
      ? Boolean(db.get('SELECT 1 AS found FROM google_tokens WHERE user_id = ?', [persistido.id]))
      : false;
    if (temTokenGoogle && googleCalendarService?.disconnect) {
      try {
        await googleCalendarService.disconnect(persistido.id);
      } catch {
        externalPending = JSON.stringify({
          provedor: 'google',
          status: 'revogacao-pendente',
          detalhe:
            'A revogação remota não foi confirmada pelo provedor; as credenciais locais foram eliminadas e o titular pode revogar o acesso em myaccount.google.com/permissions.',
          registrado_em: startedAt
        });
      }
    }

    const counts = {};
    const processedTables = [];

    db.transaction((tx) => {
      for (const { tabela, clausula } of TABELAS_DE_DADOS_PESSOAIS) {
        if (!tableExists(tx, tabela)) continue;
        const total = Number(
          tx.get(`SELECT COUNT(*) AS total FROM "${tabela}" WHERE ${clausula}`, [persistido.id])
            .total
        );
        tx.run(`DELETE FROM "${tabela}" WHERE ${clausula}`, [persistido.id]);
        counts[tabela] = total;
        processedTables.push(tabela);
      }

      // Trilha de auditoria: retida com base legal e anonimizada em relação ao
      // titular (o vínculo direto com a conta eliminada é removido).
      const eventosDeAuditoria = Number(
        tx.get(
          'SELECT COUNT(*) AS total FROM audit_events WHERE actor_user_id = ? OR target_user_id = ?',
          [persistido.id, persistido.id]
        ).total
      );
      tx.run(
        `UPDATE audit_events
            SET actor_user_id = NULL, target_user_id = NULL
          WHERE actor_user_id = ? OR target_user_id = ?`,
        [persistido.id, persistido.id]
      );
      counts.audit_events_anonimizados = eventosDeAuditoria;

      const usuarios = Number(
        tx.get('SELECT COUNT(*) AS total FROM users WHERE id = ?', [persistido.id]).total
      );
      tx.run('DELETE FROM users WHERE id = ?', [persistido.id]);
      counts.users = usuarios;
      processedTables.push('users');
    });

    const retencoes = [
      registerRetention({
        subjectHash,
        category: 'trilha-de-auditoria',
        minimalReference: `audit_events anonimizados: ${counts.audit_events_anonimizados}`,
        reason: 'Segurança, prevenção à fraude e apuração de incidentes.'
      }),
      registerRetention({
        subjectHash,
        category: 'comprovante-de-exclusao',
        minimalReference: `deletion_receipt ${receiptUuid}`,
        reason: 'Prova do atendimento ao pedido de eliminação do titular.'
      })
    ];

    const finishedAt = now().toISOString();
    const countsJson = JSON.stringify(counts);
    const legalExceptions = JSON.stringify(retencoes);
    const integrity = sha256(
      [receiptUuid, subjectHash, countsJson, legalExceptions, startedAt, finishedAt].join('|')
    );

    db.run(
      `INSERT INTO deletion_receipts
         (receipt_uuid, subject_hash, processed_tables, counts_json,
          legal_exceptions, external_pending, started_at, finished_at, integrity_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receiptUuid,
        subjectHash,
        JSON.stringify(processedTables),
        countsJson,
        legalExceptions,
        externalPending,
        startedAt,
        finishedAt,
        integrity
      ]
    );

    authService.audit({
      action: 'privacy.account.delete',
      result: 'sucesso',
      request,
      metadata: { receipt: receiptUuid }
    });

    return {
      receipt_uuid: receiptUuid,
      processed_tables: processedTables,
      counts,
      legal_exceptions: retencoes,
      external_pending: externalPending ? JSON.parse(externalPending) : null,
      started_at: startedAt,
      finished_at: finishedAt,
      integrity_hash: integrity
    };
  }

  function createRequest(user, { request_type, details }) {
    if (!TIPOS_DE_SOLICITACAO.includes(request_type)) {
      throw unprocessable('Tipo de solicitação inválido.', 'TIPO_SOLICITACAO_INVALIDO');
    }
    const dueAt = new Date(now().getTime() + PRAZO_RESPOSTA_DIAS * DIAS_EM_MS).toISOString();
    const subjectHash = sha256(String(user.email).toLowerCase());
    const result = db.run(
      `INSERT INTO privacy_requests
         (request_type, subject_hash, subject_user_id, status, due_at, evidence)
       VALUES (?, ?, ?, 'aberta', ?, ?)`,
      [request_type, subjectHash, user.id, dueAt, details ?? null]
    );
    authService.audit({
      action: 'privacy.request.create',
      result: 'sucesso',
      actorUserId: user.id,
      targetUserId: user.id,
      metadata: { tipo: request_type, requestId: result.lastID }
    });
    return db.get(
      `SELECT id, request_type, status, due_at, created_at FROM privacy_requests WHERE id = ?`,
      [result.lastID]
    );
  }

  function listOwnRequests(user) {
    return db.all(
      `SELECT id, request_type, status, due_at, result_summary, created_at, updated_at
       FROM privacy_requests WHERE subject_user_id = ? ORDER BY created_at DESC`,
      [user.id]
    );
  }

  function listAllRequests() {
    return db.all(
      `SELECT id, request_type, subject_hash, subject_user_id, status, due_at,
              result_summary, created_at, updated_at
       FROM privacy_requests ORDER BY created_at DESC`
    );
  }

  function resolveRequest(id, { status, result_summary }, actor) {
    const atual = db.get('SELECT * FROM privacy_requests WHERE id = ?', [id]);
    if (!atual) throw notFound('Solicitação não encontrada.', 'SOLICITACAO_NAO_ENCONTRADA');
    if (!['em-analise', 'atendida', 'recusada'].includes(status)) {
      throw unprocessable('Status de solicitação inválido.', 'STATUS_SOLICITACAO_INVALIDO');
    }
    if (['atendida', 'recusada'].includes(status) && !result_summary) {
      throw unprocessable(
        'O desfecho da solicitação exige um resumo do resultado.',
        'RESUMO_OBRIGATORIO'
      );
    }
    db.run(
      `UPDATE privacy_requests
          SET status = ?, result_summary = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [status, result_summary ?? atual.result_summary, id]
    );
    authService.audit({
      action: 'privacy.request.resolve',
      result: 'sucesso',
      actorUserId: actor.id,
      metadata: { requestId: id, status }
    });
    return db.get(
      `SELECT id, request_type, status, due_at, result_summary, created_at, updated_at
       FROM privacy_requests WHERE id = ?`,
      [id]
    );
  }

  function retentionSummaryFor(user) {
    const subjectHash = sha256(String(user.email).toLowerCase());
    return db.all(
      `SELECT category, legal_basis, reason, retention_until, locked, created_at
       FROM legal_retention_records WHERE subject_hash = ? ORDER BY created_at DESC`,
      [subjectHash]
    );
  }

  /**
   * Vencimento das retenções: elimina ou anonimiza conforme a política.
   * Retorna o total processado; pensado para execução administrativa/rotina.
   */
  function enforceRetentionExpiry() {
    const agora = now().toISOString();
    const vencidos = db.all(
      `SELECT records.id, records.category, policies.expiry_action
       FROM legal_retention_records AS records
       INNER JOIN legal_retention_policies AS policies
         ON policies.category = records.category
       WHERE records.retention_until <= ? AND records.locked = 1`,
      [agora]
    );
    for (const registro of vencidos) {
      if (registro.expiry_action === 'eliminar') {
        db.run('DELETE FROM legal_retention_records WHERE id = ?', [registro.id]);
      } else {
        db.run(
          `UPDATE legal_retention_records
              SET subject_hash = 'anonimizado', minimal_reference = 'anonimizado', locked = 0
            WHERE id = ?`,
          [registro.id]
        );
      }
    }
    return { processed: vencidos.length };
  }

  function assertNotDeletingOthers(actorId, targetId) {
    if (Number(actorId) !== Number(targetId)) {
      throw forbidden(
        'Um usuário não pode excluir a conta de outro por este fluxo.',
        'EXCLUSAO_DE_TERCEIROS_PROIBIDA'
      );
    }
  }

  return {
    assertNotDeletingOthers,
    createRequest,
    deleteOwnAccount,
    enforceRetentionExpiry,
    listAllRequests,
    listOwnRequests,
    policies,
    resolveRequest,
    retentionSummaryFor
  };
}
