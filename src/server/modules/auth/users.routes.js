// ============================================================================
// Kairo — Administração segura de usuários
// ============================================================================

import { Router } from 'express';
import { asyncHandler, validate } from '../../middleware/validation.js';
import { createUserSchema, updateUserSchema, userIdParamsSchema } from './auth.schemas.js';

export function createUsersRouter(options) {
  const {
    authService,
    requireAuth,
    requireAdmin,
    requireCsrf,
    requireRecentAuth,
    mutationLimiter
  } = options;
  const router = Router();

  router.use(requireAuth, requireAdmin);

  router.get('/', (_req, res) => {
    res.json(authService.listUsers());
  });

  router.post(
    '/',
    mutationLimiter,
    requireCsrf,
    requireRecentAuth,
    validate({ body: createUserSchema }),
    asyncHandler(async (req, res) => {
      const user = await authService.createUser(req.validated.body, req.user, req);
      res.status(201).json(user);
    })
  );

  router.put(
    '/:id',
    mutationLimiter,
    requireCsrf,
    requireRecentAuth,
    validate({ params: userIdParamsSchema, body: updateUserSchema }),
    asyncHandler(async (req, res) => {
      const user = await authService.updateUser(
        req.validated.params.id,
        req.validated.body,
        req.user,
        req
      );
      res.json(user);
    })
  );

  router.delete(
    '/:id',
    mutationLimiter,
    requireCsrf,
    requireRecentAuth,
    validate({ params: userIdParamsSchema }),
    (req, res) => {
      authService.deleteUser(req.validated.params.id, req.user, req);
      res.status(204).end();
    }
  );

  return router;
}
