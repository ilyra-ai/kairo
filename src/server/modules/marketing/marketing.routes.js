// ============================================================================
// Kairo — Contrato público e somente leitura da landing
// ============================================================================

import { Router } from 'express';

export function createMarketingRouter({ marketingService }) {
  if (!marketingService) {
    throw new Error('O serviço de marketing é obrigatório para criar as rotas públicas.');
  }
  const router = Router();

  router.get('/landing', (_req, res) => {
    res.json(marketingService.landingConfiguration());
  });

  return router;
}
