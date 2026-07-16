// ============================================================================
// Kairo — Operações sensíveis de configuração pessoal
// ============================================================================

import { Router } from 'express';

export function createSettingsRouter(options) {
  const {
    resetWorkspace,
    authService,
    requireAuth,
    requireCsrf,
    requireRecentAuth,
    sensitiveLimiter
  } = options;
  const router = Router();

  router.use(requireAuth);

  router.post('/reset', sensitiveLimiter, requireCsrf, requireRecentAuth, (req, res) => {
    const result = resetWorkspace(req.user);
    authService.audit({
      action: 'workspace.reset',
      result: 'sucesso',
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      request: req
    });
    res.json({
      message: 'Seu espaço pessoal foi restaurado com segurança.',
      activitiesCreated: result.activities
    });
  });

  return router;
}
