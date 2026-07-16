// ============================================================================
// Kairo — Rotas do perfil individual
// ============================================================================

import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import { updateProfileSchema } from './profile.schemas.js';

export function createProfileRouter(options) {
  const {
    profileService,
    authService,
    requireAuth,
    requireCsrf,
    requireRecentAuth,
    mutationLimiter
  } = options;
  const router = Router();

  router.use(requireAuth);

  router.get('/', (req, res) => {
    res.json(profileService.get(req.user.id));
  });

  router.put(
    '/',
    mutationLimiter,
    requireCsrf,
    requireRecentAuth,
    validate({ body: updateProfileSchema }),
    (req, res) => {
      const profile = profileService.update(
        req.user.id,
        req.validated.body,
        req.authSession.id
      );
      authService.audit({
        action: 'profile.update',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { campos: Object.keys(req.validated.body).filter((field) => field !== 'avatar') }
      });
      res.json({ message: 'Perfil atualizado com sucesso.', profile });
    }
  );

  return router;
}
