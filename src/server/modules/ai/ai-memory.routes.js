// ============================================================================
// Kairo — Rotas de memória de IA do PRÓPRIO usuário (Tarefa 28)
// ----------------------------------------------------------------------------
// Somente o usuário autenticado acessa e vê o conteúdo da sua memória. Não há
// rota que exponha memória de outro usuário. As rotas administrativas (apenas
// metadados) ficam no router admin de IA.
// ============================================================================

import { Router } from 'express';
import { asyncHandler, validate } from '../../middleware/validation.js';
import { memoryItemIdParamsSchema, rememberMemorySchema } from './ai.schemas.js';

export function createAiMemoryRouter(options) {
  const { memoryService, authService, requireAuth, requireCsrf, mutationLimiter } = options;
  const router = Router();

  router.use(requireAuth);

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

  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      res.json(memoryService.status(req.user.id));
    })
  );

  // Leitura do PRÓPRIO conteúdo (descriptografado) — exclusivo do dono.
  router.get(
    '/items',
    asyncHandler(async (req, res) => {
      res.json({ items: memoryService.listOwn(req.user.id) });
    })
  );

  router.post(
    '/enable',
    mutationLimiter,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const r = memoryService.enable(req.user.id);
      audit(req, 'ai.memory.enable');
      res.json(r);
    })
  );

  router.post(
    '/disable',
    mutationLimiter,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const r = memoryService.disable(req.user.id);
      audit(req, 'ai.memory.disable');
      res.json(r);
    })
  );

  router.post(
    '/items',
    mutationLimiter,
    requireCsrf,
    validate({ body: rememberMemorySchema }),
    asyncHandler(async (req, res) => {
      const r = memoryService.remember(req.user.id, req.validated.body);
      audit(req, 'ai.memory.remember', { type: r.type });
      res.status(201).json(r);
    })
  );

  router.delete(
    '/items/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: memoryItemIdParamsSchema }),
    asyncHandler(async (req, res) => {
      memoryService.forget(req.user.id, req.validated.params.id);
      audit(req, 'ai.memory.forget', { item_id: req.validated.params.id });
      res.status(204).end();
    })
  );

  // Limpeza total da própria memória (direito do titular), com comprovante.
  router.delete(
    '/',
    mutationLimiter,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const r = memoryService.purge(req.user.id, { scope: 'total' });
      audit(req, 'ai.memory.purge', { items: r.deleted_items });
      res.json(r);
    })
  );

  return router;
}
