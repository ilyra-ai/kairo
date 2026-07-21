// ============================================================================
// Kairo — Rotas de analytics temporal da agenda (Tarefa 20)
// ============================================================================

import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import { drilldownQuerySchema, timeseriesQuerySchema } from './analytics.schemas.js';

export function createAnalyticsRouter(options) {
  const { analyticsService, requireAuth } = options;
  const router = Router();

  router.use(requireAuth);

  // Série temporal agregada + valores disponíveis para os filtros dinâmicos.
  router.get('/timeseries', validate({ query: timeseriesQuerySchema }), (req, res) => {
    res.json(analyticsService.timeseries(req.user.id, req.validated.query));
  });

  // Drill-down: compromissos reais da data clicada (base da tabela editável).
  router.get('/drilldown', validate({ query: drilldownQuerySchema }), (req, res) => {
    res.json({
      date: req.validated.query.date,
      events: analyticsService.drilldown(req.user.id, req.validated.query.date)
    });
  });

  return router;
}
