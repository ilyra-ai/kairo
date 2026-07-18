// ============================================================================
// Kairo — Rotas do perfil individual
// ============================================================================

import { Router } from 'express';
import { asyncHandler, validate } from '../../middleware/validation.js';
import { forbidden } from '../../shared/http-error.js';
import {
  updateProfilePasswordSchema,
  updateProfilePreferencesSchema,
  updateProfileSchema
} from './profile.schemas.js';

export function createProfileRouter(options) {
  const { profileService, plansService, authService, requireAuth, requireCsrf, mutationLimiter } =
    options;
  const router = Router();

  router.use(requireAuth);

  router.get('/', (req, res) => {
    res.json(profileService.get(req.user.id));
  });

  router.put(
    '/',
    mutationLimiter,
    requireCsrf,
    validate({ body: updateProfileSchema }),
    (req, res) => {
      const profile = profileService.update(req.user.id, req.validated.body, req.authSession.id);
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

  router.put(
    '/preferences',
    mutationLimiter,
    requireCsrf,
    validate({ body: updateProfilePreferencesSchema }),
    (req, res) => {
      if (
        req.validated.body.focus_sound === 'binaural' &&
        !plansService.planCan(req.user.plan, 'binaural', req.user.role)
      ) {
        throw forbidden(
          'Seu plano atual não inclui ondas binaurais.',
          'FUNCIONALIDADE_NAO_INCLUIDA'
        );
      }
      const profile = profileService.updatePreferences(req.user.id, req.validated.body);
      authService.audit({
        action: 'profile.preferences.update',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { campos: Object.keys(req.validated.body) }
      });
      res.json({ message: 'Preferências atualizadas com sucesso.', profile });
    }
  );

  // Troca de senha pelo próprio usuário. É o único ponto do aplicativo, além do
  // login, em que a senha volta a ser solicitada: a senha atual é exigida no
  // próprio formulário e conferida no servidor antes de gravar a nova.
  router.put(
    '/password',
    mutationLimiter,
    requireCsrf,
    validate({ body: updateProfilePasswordSchema }),
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.validated.body;
      await authService.changeOwnPassword(
        req.user,
        { currentPassword, newPassword },
        req.authSession,
        req
      );
      res.json({
        message: 'Senha alterada com sucesso.'
      });
    })
  );

  return router;
}
