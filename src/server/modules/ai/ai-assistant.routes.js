// ============================================================================
// Kairo — Rotas do assistente pessoal com histórico e streaming cancelável
// ============================================================================

import { Router } from 'express';
import { asyncHandler, validate } from '../../middleware/validation.js';
import { unprocessable } from '../../shared/http-error.js';
import {
  assistantChatSchema,
  assistantCopilotSchema,
  assistantHistoryQuerySchema,
  assistantProposalParamsSchema
} from './ai.schemas.js';

function publicStreamError(error) {
  if (error?.status && error.status < 500) {
    return { code: error.code, message: error.message };
  }
  if (error?.code === 'CANCELADO') {
    return { code: 'CANCELADO', message: 'A resposta foi interrompida.' };
  }
  return { code: 'ERRO_ASSISTENTE', message: 'Não foi possível concluir a resposta.' };
}

export function createAiAssistantRouter(options) {
  const { assistantService, authService, requireAuth, requireCsrf, mutationLimiter } = options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      res.json(assistantService.status(req.user.id));
    })
  );

  router.get(
    '/history',
    validate({ query: assistantHistoryQuerySchema }),
    asyncHandler(async (req, res) => {
      res.json(assistantService.history(req.user.id, req.validated.query));
    })
  );

  router.delete(
    '/history',
    mutationLimiter,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const result = assistantService.clearHistory(req.user.id);
      authService.audit({
        action: 'ai.assistant.history.clear',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: result
      });
      res.json(result);
    })
  );

  router.get(
    '/tools',
    asyncHandler(async (req, res) => {
      res.json({ tools: assistantService.tools(req.user.id) });
    })
  );

  router.delete(
    '/proposals/:proposal_id',
    mutationLimiter,
    requireCsrf,
    validate({ params: assistantProposalParamsSchema }),
    asyncHandler(async (req, res) => {
      const result = assistantService.cancelProposal(req.user.id, req.validated.params.proposal_id);
      authService.audit({
        action: 'ai.assistant.proposal.cancel',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { proposal_id: result.proposal_id }
      });
      res.json(result);
    })
  );

  router.post(
    '/chat',
    mutationLimiter,
    requireCsrf,
    validate({ body: assistantChatSchema }),
    asyncHandler(async (req, res) => {
      const result = await assistantService.chat(req.user.id, req.validated.body);
      authService.audit({
        action: req.validated.body.confirm ? 'ai.assistant.action' : 'ai.assistant.chat',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: {
          executions: result.executions?.length ?? 0,
          proposals: result.proposals?.length ?? 0
        }
      });
      res.json(result);
    })
  );

  router.post(
    '/chat/stream',
    mutationLimiter,
    requireCsrf,
    validate({ body: assistantChatSchema }),
    asyncHandler(async (req, res) => {
      if (req.validated.body.confirm) {
        throw unprocessable(
          'Confirmações são processadas pela rota de chat sem streaming.',
          'CONFIRMACAO_STREAM_INVALIDA'
        );
      }
      res.status(200);
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders?.();

      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on('close', onClose);
      const send = (event, payload) => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        }
      };

      try {
        const result = await assistantService.chat(req.user.id, req.validated.body, {
          stream: true,
          externalSignal: controller.signal,
          onDelta: (event) => send('delta', { type: 'delta', delta: event.delta ?? '' })
        });
        send('done', { type: 'done', ...result });
        authService.audit({
          action: 'ai.assistant.chat.stream',
          result: 'sucesso',
          actorUserId: req.user.id,
          targetUserId: req.user.id,
          request: req,
          metadata: {
            executions: result.executions?.length ?? 0,
            proposals: result.proposals?.length ?? 0
          }
        });
      } catch (error) {
        if (!controller.signal.aborted)
          send('error', { type: 'error', ...publicStreamError(error) });
      } finally {
        res.off('close', onClose);
        if (!res.writableEnded && !res.destroyed) res.end();
      }
    })
  );

  router.post(
    '/copilot',
    mutationLimiter,
    requireCsrf,
    validate({ body: assistantCopilotSchema }),
    asyncHandler(async (req, res) => {
      const result = await assistantService.copilot(req.user.id, req.validated.body);
      authService.audit({
        action: 'ai.assistant.copilot',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { kind: result.kind }
      });
      res.json(result);
    })
  );

  return router;
}
