// ============================================================================
// Kairo — Rotas do construtor de gráficos personalizados (Tarefa 21)
// ============================================================================

import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import {
  chartIdParamsSchema,
  createChartSchema,
  previewChartSchema,
  reorderChartsSchema,
  updateChartSchema
} from './charts.schemas.js';

export function createChartsRouter(options) {
  const { chartsService, authService, requireAuth, requireCsrf, mutationLimiter } = options;
  const router = Router();

  router.use(requireAuth);

  // Catálogo de fontes, dimensões, métricas e tipos para montar o construtor.
  router.get('/catalog', (_req, res) => {
    res.json(chartsService.catalog());
  });

  router.get('/', (req, res) => {
    res.json(chartsService.list(req.user.id));
  });

  // Prévia com dados reais, sem persistir.
  router.post(
    '/preview',
    mutationLimiter,
    requireCsrf,
    validate({ body: previewChartSchema }),
    (req, res) => {
      res.json(chartsService.preview(req.user.id, req.validated.body));
    }
  );

  // Reordenação (antes de :id para não colidir com o parâmetro).
  router.put(
    '/reorder',
    mutationLimiter,
    requireCsrf,
    validate({ body: reorderChartsSchema }),
    (req, res) => {
      res.json(chartsService.reorder(req.user.id, req.validated.body.order));
    }
  );

  router.get('/:id/data', validate({ params: chartIdParamsSchema }), (req, res) => {
    res.json(chartsService.render(req.user.id, req.validated.params.id));
  });

  router.post(
    '/',
    mutationLimiter,
    requireCsrf,
    validate({ body: createChartSchema }),
    (req, res) => {
      const chart = chartsService.create(req.user.id, req.validated.body);
      authService.audit({
        action: 'charts.create',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { chartId: chart.id }
      });
      res.status(201).json(chart);
    }
  );

  router.post(
    '/:id/duplicate',
    mutationLimiter,
    requireCsrf,
    validate({ params: chartIdParamsSchema }),
    (req, res) => {
      const chart = chartsService.duplicate(req.user.id, req.validated.params.id);
      res.status(201).json(chart);
    }
  );

  router.put(
    '/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: chartIdParamsSchema, body: updateChartSchema }),
    (req, res) => {
      res.json(chartsService.update(req.user.id, req.validated.params.id, req.validated.body));
    }
  );

  router.delete(
    '/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: chartIdParamsSchema }),
    (req, res) => {
      chartsService.remove(req.user.id, req.validated.params.id);
      authService.audit({
        action: 'charts.delete',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { chartId: req.validated.params.id }
      });
      res.status(204).end();
    }
  );

  return router;
}
