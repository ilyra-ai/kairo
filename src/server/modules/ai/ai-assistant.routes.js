// ============================================================================
// Kairo — Rotas do assistente de IA do próprio usuário (Tarefa 16)
// ----------------------------------------------------------------------------
// Chat com ações reais e copiloto de escrita. Exige autenticação e o recurso
// `ai_assistant` no plano (aplicado na montagem). As ações operam apenas sobre
// os dados do usuário autenticado; ações sensíveis exigem confirmação explícita.
// ============================================================================

import { Router } from 'express';
import { asyncHandler, validate } from '../../middleware/validation.js';
import { assistantChatSchema, assistantCopilotSchema } from './ai.schemas.js';

export function createAiAssistantRouter(options) {
  const { assistantService, authService, requireAuth, requireCsrf, mutationLimiter } = options;
  const router = Router();

  router.use(requireAuth);

  router.get(
    '/tools',
    asyncHandler(async (_req, res) => {
      res.json({ tools: assistantService.tools() });
    })
  );

  router.post(
    '/chat',
    mutationLimiter,
    requireCsrf,
    validate({ body: assistantChatSchema }),
    asyncHandler(async (req, res) => {
      const resultado = await assistantService.chat(req.user.id, req.validated.body);
      authService.audit({
        action: req.validated.body.confirm ? 'ai.assistant.action' : 'ai.assistant.chat',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: {
          executions: resultado.executions?.length ?? 0,
          proposals: resultado.proposals?.length ?? 0
        }
      });
      res.json(resultado);
    })
  );

  router.post(
    '/copilot',
    mutationLimiter,
    requireCsrf,
    validate({ body: assistantCopilotSchema }),
    asyncHandler(async (req, res) => {
      const resultado = await assistantService.copilot(req.user.id, req.validated.body);
      authService.audit({
        action: 'ai.assistant.copilot',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { kind: resultado.kind }
      });
      res.json(resultado);
    })
  );

  return router;
}
