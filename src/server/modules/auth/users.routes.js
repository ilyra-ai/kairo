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

  // Política de reautenticação do Kairo: a senha só é solicitada novamente
  // quando a operação realmente altera a senha de alguém. Nenhuma outra ação
  // do aplicativo — navegar, criar, editar ou excluir registros — volta a
  // pedir a senha do usuário autenticado.
  function requireRecentAuthAoTrocarSenha(req, res, next) {
    const alterandoSenha = typeof req.body?.password === 'string' && req.body.password.length > 0;
    if (!alterandoSenha) return next();
    return requireRecentAuth(req, res, next);
  }

  router.use(requireAuth, requireAdmin);

  router.get('/', (_req, res) => {
    res.json(authService.listUsers());
  });

  router.post(
    '/',
    mutationLimiter,
    requireCsrf,
    requireRecentAuthAoTrocarSenha,
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
    requireRecentAuthAoTrocarSenha,
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
    requireRecentAuthAoTrocarSenha,
    validate({ params: userIdParamsSchema }),
    (req, res) => {
      authService.deleteUser(req.validated.params.id, req.user, req);
      res.status(204).end();
    }
  );

  return router;
}
