// ============================================================================
// Kairo — Rotas administrativas do gateway de IA (Tarefa 15)
// ----------------------------------------------------------------------------
// Todas as rotas exigem autenticação e perfil administrador. Segredos nunca são
// devolvidos; ações de rede (teste, descoberta, capability-check) são reais.
// ============================================================================

import { Router } from 'express';
import { asyncHandler, validate } from '../../middleware/validation.js';
import {
  adminBlockWritesSchema,
  approveTrainingVersionSchema,
  aiConnectionIdParamsSchema,
  aiModelIdParamsSchema,
  canaryIdParamsSchema,
  compareTrainingVersionsQuerySchema,
  createAiConnectionSchema,
  createMcpServerSchema,
  createTrainingArtifactSchema,
  evaluateTrainingArtifactSchema,
  finishCanarySchema,
  governanceDecisionSchema,
  listModelsQuerySchema,
  listTrainingQuerySchema,
  mcpServerIdParamsSchema,
  memoryUserIdParamsSchema,
  rollbackTrainingVersionSchema,
  startCanarySchema,
  toolNameParamsSchema,
  trainingArtifactIdParamsSchema,
  updateAiConnectionSchema,
  updateAiModelSchema,
  updateEvaluationSettingsSchema,
  updateMcpServerSchema,
  updateRouterPolicySchema,
  updateTrainingArtifactSchema,
  upsertToolPolicySchema
} from './ai.schemas.js';

export function createAiRouter(options) {
  const {
    aiService,
    aiTrainingService,
    aiMemoryService,
    aiGovernanceService,
    authService,
    requireAuth,
    requireAdmin,
    requireCsrf,
    mutationLimiter
  } = options;
  const router = Router();

  router.use(requireAuth, requireAdmin);

  function audit(req, action, metadata) {
    authService.audit({
      action,
      result: 'sucesso',
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      request: req,
      metadata
    });
  }

  // ------------------------------------------------------------------ Conexões
  router.get(
    '/connections',
    asyncHandler(async (_req, res) => {
      res.json({ connections: aiService.listConnections() });
    })
  );

  router.get(
    '/connections/:id',
    validate({ params: aiConnectionIdParamsSchema }),
    asyncHandler(async (req, res) => {
      res.json(aiService.getConnection(req.validated.params.id));
    })
  );

  router.post(
    '/connections',
    mutationLimiter,
    requireCsrf,
    validate({ body: createAiConnectionSchema }),
    asyncHandler(async (req, res) => {
      const conexao = await aiService.createConnection(req.validated.body, req.user.id);
      audit(req, 'ai.connection.create', {
        connection_id: conexao.id,
        provider_type: conexao.provider_type
      });
      res.status(201).json(conexao);
    })
  );

  router.put(
    '/connections/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: aiConnectionIdParamsSchema, body: updateAiConnectionSchema }),
    asyncHandler(async (req, res) => {
      const conexao = await aiService.updateConnection(req.validated.params.id, req.validated.body);
      audit(req, 'ai.connection.update', { connection_id: conexao.id });
      res.json(conexao);
    })
  );

  router.delete(
    '/connections/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: aiConnectionIdParamsSchema }),
    asyncHandler(async (req, res) => {
      aiService.deleteConnection(req.validated.params.id);
      audit(req, 'ai.connection.delete', { connection_id: req.validated.params.id });
      res.status(204).end();
    })
  );

  router.post(
    '/connections/:id/test',
    mutationLimiter,
    requireCsrf,
    validate({ params: aiConnectionIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const resultado = await aiService.testConnection(req.validated.params.id);
      audit(req, 'ai.connection.test', {
        connection_id: req.validated.params.id,
        health_status: resultado.health_status
      });
      res.json(resultado);
    })
  );

  router.post(
    '/connections/:id/discover-models',
    mutationLimiter,
    requireCsrf,
    validate({ params: aiConnectionIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const modelos = await aiService.discoverModels(req.validated.params.id);
      audit(req, 'ai.connection.discover', {
        connection_id: req.validated.params.id,
        models: modelos.length
      });
      res.json({ models: modelos });
    })
  );

  // -------------------------------------------------------------------- Modelos
  router.get(
    '/models',
    validate({ query: listModelsQuerySchema }),
    asyncHandler(async (req, res) => {
      res.json({ models: aiService.listModels(req.validated.query) });
    })
  );

  router.put(
    '/models/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: aiModelIdParamsSchema, body: updateAiModelSchema }),
    asyncHandler(async (req, res) => {
      const modelo = aiService.updateModel(req.validated.params.id, req.validated.body);
      audit(req, 'ai.model.update', { model_id: modelo.id });
      res.json(modelo);
    })
  );

  router.post(
    '/models/:id/capability-check',
    mutationLimiter,
    requireCsrf,
    validate({ params: aiModelIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const modelo = await aiService.capabilityCheck(req.validated.params.id);
      audit(req, 'ai.model.capability_check', { model_id: modelo.id });
      res.json(modelo);
    })
  );

  // =====================================================================
  // Estúdio de Treinamento (Tarefa 27) — só habilita se o serviço existir
  // =====================================================================
  if (aiTrainingService) {
    router.get(
      '/training/artifacts',
      validate({ query: listTrainingQuerySchema }),
      asyncHandler(async (req, res) => {
        res.json({ artifacts: aiTrainingService.listArtifacts(req.validated.query) });
      })
    );

    router.get(
      '/training/artifacts/:id',
      validate({ params: trainingArtifactIdParamsSchema }),
      asyncHandler(async (req, res) => {
        res.json(aiTrainingService.getArtifact(req.validated.params.id));
      })
    );

    router.get(
      '/training/artifacts/:id/versions',
      validate({ params: trainingArtifactIdParamsSchema }),
      asyncHandler(async (req, res) => {
        res.json({ versions: aiTrainingService.listVersions(req.validated.params.id) });
      })
    );

    router.get(
      '/training/artifacts/:id/compare',
      validate({
        params: trainingArtifactIdParamsSchema,
        query: compareTrainingVersionsQuerySchema
      }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.compareVersions(
            req.validated.params.id,
            req.validated.query.left,
            req.validated.query.right
          )
        );
      })
    );

    router.get(
      '/training/artifacts/:id/evaluations',
      validate({ params: trainingArtifactIdParamsSchema }),
      asyncHandler(async (req, res) => {
        res.json({ evaluations: aiTrainingService.listEvaluations(req.validated.params.id) });
      })
    );

    router.get(
      '/training/evaluation-settings',
      asyncHandler(async (_req, res) => {
        res.json(aiTrainingService.getEvaluationSettings());
      })
    );

    router.put(
      '/training/evaluation-settings',
      mutationLimiter,
      requireCsrf,
      validate({ body: updateEvaluationSettingsSchema }),
      asyncHandler(async (req, res) => {
        res.json(aiTrainingService.updateEvaluationSettings(req.validated.body, req.user.id));
      })
    );

    router.post(
      '/training/artifacts',
      mutationLimiter,
      requireCsrf,
      validate({ body: createTrainingArtifactSchema }),
      asyncHandler(async (req, res) => {
        const artefato = aiTrainingService.createArtifact(req.validated.body, req.user.id);
        res.status(201).json(artefato);
      })
    );

    router.put(
      '/training/artifacts/:id',
      mutationLimiter,
      requireCsrf,
      validate({ params: trainingArtifactIdParamsSchema, body: updateTrainingArtifactSchema }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.updateArtifact(req.validated.params.id, req.validated.body, req.user.id)
        );
      })
    );

    router.post(
      '/training/artifacts/:id/duplicate',
      mutationLimiter,
      requireCsrf,
      validate({ params: trainingArtifactIdParamsSchema }),
      asyncHandler(async (req, res) => {
        res
          .status(201)
          .json(aiTrainingService.duplicateArtifact(req.validated.params.id, req.user.id));
      })
    );

    router.post(
      '/training/artifacts/:id/validate',
      mutationLimiter,
      requireCsrf,
      validate({
        params: trainingArtifactIdParamsSchema,
        body: evaluateTrainingArtifactSchema
      }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.evaluateArtifact(
            req.validated.params.id,
            req.user.id,
            req.validated.body
          )
        );
      })
    );

    router.post(
      '/training/artifacts/:id/evaluate',
      mutationLimiter,
      requireCsrf,
      validate({
        params: trainingArtifactIdParamsSchema,
        body: evaluateTrainingArtifactSchema
      }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.evaluateArtifact(
            req.validated.params.id,
            req.user.id,
            req.validated.body
          )
        );
      })
    );

    router.post(
      '/training/artifacts/:id/approve',
      mutationLimiter,
      requireCsrf,
      validate({ params: trainingArtifactIdParamsSchema, body: approveTrainingVersionSchema }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.approveVersion(req.validated.params.id, req.validated.body, req.user.id)
        );
      })
    );

    router.post(
      '/training/artifacts/:id/approval/revoke',
      mutationLimiter,
      requireCsrf,
      validate({ params: trainingArtifactIdParamsSchema, body: approveTrainingVersionSchema }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.revokeVersionApproval(
            req.validated.params.id,
            req.validated.body,
            req.user.id
          )
        );
      })
    );

    router.post(
      '/training/artifacts/:id/publish',
      mutationLimiter,
      requireCsrf,
      validate({ params: trainingArtifactIdParamsSchema }),
      asyncHandler(async (req, res) => {
        res.json(aiTrainingService.publishArtifact(req.validated.params.id, req.user.id));
      })
    );

    router.post(
      '/training/artifacts/:id/rollback',
      mutationLimiter,
      requireCsrf,
      validate({
        params: trainingArtifactIdParamsSchema,
        body: rollbackTrainingVersionSchema
      }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.rollbackArtifact(
            req.validated.params.id,
            req.user.id,
            req.validated.body
          )
        );
      })
    );

    router.post(
      '/training/artifacts/:id/canary',
      mutationLimiter,
      requireCsrf,
      validate({ params: trainingArtifactIdParamsSchema, body: startCanarySchema }),
      asyncHandler(async (req, res) => {
        res
          .status(201)
          .json(
            aiTrainingService.startCanary(req.validated.params.id, req.validated.body, req.user.id)
          );
      })
    );

    router.get(
      '/training/artifacts/:id/canaries',
      validate({ params: trainingArtifactIdParamsSchema }),
      asyncHandler(async (req, res) => {
        res.json({ canaries: aiTrainingService.listCanaries(req.validated.params.id) });
      })
    );

    router.get(
      '/training/scorecards',
      asyncHandler(async (_req, res) => {
        res.json(aiTrainingService.llmOpsScorecards());
      })
    );

    router.post(
      '/training/canaries/:id/finish',
      mutationLimiter,
      requireCsrf,
      validate({ params: canaryIdParamsSchema, body: finishCanarySchema }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.finishCanary(req.validated.params.id, req.validated.body, req.user.id)
        );
      })
    );

    router.post(
      '/training/artifacts/:id/archive',
      mutationLimiter,
      requireCsrf,
      validate({ params: trainingArtifactIdParamsSchema }),
      asyncHandler(async (req, res) => {
        res.json(aiTrainingService.archiveArtifact(req.validated.params.id, req.user.id));
      })
    );

    router.post(
      '/training/artifacts/:id/restore',
      mutationLimiter,
      requireCsrf,
      validate({ params: trainingArtifactIdParamsSchema }),
      asyncHandler(async (req, res) => {
        res.json(aiTrainingService.restoreArtifact(req.validated.params.id, req.user.id));
      })
    );

    router.delete(
      '/training/artifacts/:id',
      mutationLimiter,
      requireCsrf,
      validate({ params: trainingArtifactIdParamsSchema }),
      asyncHandler(async (req, res) => {
        aiTrainingService.deleteArtifact(req.validated.params.id, req.user.id);
        res.status(204).end();
      })
    );

    // Contexto ativo (competências publicadas) e observabilidade.
    router.get(
      '/training/active-context',
      asyncHandler(async (_req, res) => {
        res.json({ context: aiTrainingService.activeContext() });
      })
    );

    router.get(
      '/tool-policies',
      asyncHandler(async (_req, res) => {
        res.json({ policies: aiTrainingService.listToolPolicies() });
      })
    );

    router.put(
      '/tool-policies',
      mutationLimiter,
      requireCsrf,
      validate({ body: upsertToolPolicySchema }),
      asyncHandler(async (req, res) => {
        res.json(aiTrainingService.upsertToolPolicy(req.validated.body, req.user.id));
      })
    );

    router.post(
      '/tool-policies/:tool_name/decision',
      mutationLimiter,
      requireCsrf,
      validate({ params: toolNameParamsSchema, body: governanceDecisionSchema }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.decideToolPolicy(
            req.validated.params.tool_name,
            req.validated.body.action,
            req.user.id,
            req.validated.body.rationale
          )
        );
      })
    );

    router.get(
      '/tool-audit',
      asyncHandler(async (req, res) => {
        res.json({ events: aiTrainingService.listToolAudit(req.query.limit) });
      })
    );

    router.get(
      '/mcp/servers',
      asyncHandler(async (_req, res) => {
        res.json({ servers: aiTrainingService.listMcpServers() });
      })
    );

    router.post(
      '/mcp/servers',
      mutationLimiter,
      requireCsrf,
      validate({ body: createMcpServerSchema }),
      asyncHandler(async (req, res) => {
        res.status(201).json(aiTrainingService.createMcpServer(req.validated.body, req.user.id));
      })
    );

    router.put(
      '/mcp/servers/:id',
      mutationLimiter,
      requireCsrf,
      validate({ params: mcpServerIdParamsSchema, body: updateMcpServerSchema }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.updateMcpServer(
            req.validated.params.id,
            req.validated.body,
            req.user.id
          )
        );
      })
    );

    router.post(
      '/mcp/servers/:id/decision',
      mutationLimiter,
      requireCsrf,
      validate({ params: mcpServerIdParamsSchema, body: governanceDecisionSchema }),
      asyncHandler(async (req, res) => {
        res.json(
          aiTrainingService.decideMcpServer(
            req.validated.params.id,
            req.validated.body,
            req.user.id
          )
        );
      })
    );

    router.delete(
      '/mcp/servers/:id',
      mutationLimiter,
      requireCsrf,
      validate({ params: mcpServerIdParamsSchema }),
      asyncHandler(async (req, res) => {
        aiTrainingService.deleteMcpServer(req.validated.params.id, req.user.id);
        res.status(204).end();
      })
    );

    router.get(
      '/audit',
      asyncHandler(async (req, res) => {
        res.json({ events: aiTrainingService.listAudit(req.query.limit) });
      })
    );
  }

  // =====================================================================
  // Memória de IA — administração APENAS por metadados (sem leitura de conteúdo)
  // =====================================================================
  if (aiMemoryService) {
    router.get(
      '/memory/users',
      asyncHandler(async (_req, res) => {
        res.json({ users: aiMemoryService.adminListUsers() });
      })
    );

    router.get(
      '/memory/users/:id/stats',
      validate({ params: memoryUserIdParamsSchema }),
      asyncHandler(async (req, res) => {
        res.json(aiMemoryService.adminStats(req.validated.params.id));
      })
    );

    router.put(
      '/memory/users/:id/block-writes',
      mutationLimiter,
      requireCsrf,
      validate({ params: memoryUserIdParamsSchema, body: adminBlockWritesSchema }),
      asyncHandler(async (req, res) => {
        const r = aiMemoryService.adminBlockWrites(
          req.validated.params.id,
          req.validated.body.blocked
        );
        audit(req, 'ai.memory.admin.block_writes', {
          target: req.validated.params.id,
          blocked: req.validated.body.blocked
        });
        res.json(r);
      })
    );

    router.delete(
      '/memory/users/:id',
      mutationLimiter,
      requireCsrf,
      validate({ params: memoryUserIdParamsSchema }),
      asyncHandler(async (req, res) => {
        const r = aiMemoryService.purge(req.validated.params.id, { scope: 'admin' });
        audit(req, 'ai.memory.admin.purge', {
          target: req.validated.params.id,
          items: r.deleted_items
        });
        res.json(r);
      })
    );

    router.post(
      '/memory/users/:id/rotate-key',
      mutationLimiter,
      requireCsrf,
      validate({ params: memoryUserIdParamsSchema }),
      asyncHandler(async (req, res) => {
        const r = aiMemoryService.rotateKey(req.validated.params.id);
        audit(req, 'ai.memory.admin.rotate_key', { target: req.validated.params.id });
        res.json(r);
      })
    );

    // Dashboard de memória (Tarefa 30) — agregações reais, sem conteúdo.
    router.get(
      '/memory/dashboard/summary',
      asyncHandler(async (_req, res) => {
        res.json(aiMemoryService.adminSummary());
      })
    );

    router.get(
      '/memory/dashboard/top',
      asyncHandler(async (req, res) => {
        res.json({ top: aiMemoryService.adminTop(req.query.limit) });
      })
    );

    router.get(
      '/memory/dashboard/timeseries',
      asyncHandler(async (req, res) => {
        res.json(
          aiMemoryService.adminTimeseries({
            granularity: req.query.granularity || 'day',
            from: req.query.from || null,
            to: req.query.to || null
          })
        );
      })
    );

    router.get(
      '/memory/privacy-posture',
      asyncHandler(async (_req, res) => {
        res.json(aiMemoryService.adminPrivacyPosture());
      })
    );
  }

  // =====================================================================
  // Governança de IA 2026 (Tarefa 30) — Model Router + observabilidade
  // =====================================================================
  if (aiGovernanceService) {
    router.get(
      '/governance/router',
      asyncHandler(async (_req, res) => {
        res.json(aiGovernanceService.getRouterPolicy());
      })
    );

    router.put(
      '/governance/router',
      mutationLimiter,
      requireCsrf,
      validate({ body: updateRouterPolicySchema }),
      asyncHandler(async (req, res) => {
        const r = aiGovernanceService.updateRouterPolicy(req.validated.body, req.user.id);
        audit(req, 'ai.governance.router.update', { version: r.version });
        res.json(r);
      })
    );

    router.get(
      '/governance/observability',
      asyncHandler(async (req, res) => {
        res.json(
          aiGovernanceService.observability({
            from: req.query.from || null,
            to: req.query.to || null
          })
        );
      })
    );
  }

  return router;
}
