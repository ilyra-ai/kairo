// ============================================================================
// Kairo — Rotas de usuário dos recursos inteligentes (Tarefa 35)
// ----------------------------------------------------------------------------
// Endpoints consumidos pelo próprio usuário. Cada engine valida internamente se
// o recurso está habilitado pelo administrador (governança smart_features).
// ============================================================================

import { Router } from 'express';
import { asyncHandler } from '../../middleware/validation.js';

export function createSmartUserRouter(options) {
  const { energyBudgetService, requireAuth } = options;
  const router = Router();

  router.use(requireAuth);

  // 35.1 — Orçamento de energia do dia (bateria do dia).
  if (energyBudgetService) {
    router.get(
      '/energy-budget',
      asyncHandler(async (req, res) => {
        res.json(energyBudgetService.computeDay(req.user.id, req.query.date));
      })
    );
  }

  return router;
}
