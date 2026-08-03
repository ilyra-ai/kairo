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

  // Busca por significado dentro da própria memória. É GET porque não altera
  // nada, e a consulta viaja como parâmetro de rota — nunca em corpo, para que
  // o histórico de acesso registre o que foi procurado.
  router.get(
    '/search',
    asyncHandler(async (req, res) => {
      const consulta = String(req.query.q ?? '').trim();
      const limite = Number.parseInt(req.query.limit, 10);
      const minimo = Number.parseFloat(req.query.min);
      const resultado = await memoryService.searchSemantic(req.user.id, consulta, {
        limite: Number.isFinite(limite) ? limite : 5,
        minimo: Number.isFinite(minimo) ? minimo : 0.25
      });
      res.json(resultado);
    })
  );

  // Vetoriza o que ficou para trás: memórias criadas antes da busca semântica
  // existir, ou gravadas enquanto o servidor de embeddings estava fora.
  router.post(
    '/reindex',
    mutationLimiter,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const limite = Number.parseInt(req.body?.limit, 10);
      const r = await memoryService.indexarPendentes(req.user.id, {
        limite: Number.isFinite(limite) ? limite : 50
      });
      audit(req, 'ai.memory.reindex', { processados: r.processados, indexados: r.indexados });
      res.json(r);
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
