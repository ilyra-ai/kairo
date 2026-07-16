// ============================================================================
// Kairo — Rotas do dashboard pessoal
// ============================================================================

import { Router } from 'express';

export function createDashboardRouter({ dashboardService, requireAuth }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/kpis', (req, res) => {
    res.json(dashboardService.getKpis(req.user.id));
  });

  return router;
}
