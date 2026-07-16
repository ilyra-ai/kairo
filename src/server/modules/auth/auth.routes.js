// ============================================================================
// Kairo — Rotas públicas e privadas de autenticação
// ============================================================================

import { Router } from 'express';
import { forbidden } from '../../shared/http-error.js';
import { asyncHandler, validate } from '../../middleware/validation.js';
import { loginSchema, reauthenticateSchema, registerSchema } from './auth.schemas.js';

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || req.ip || '';
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

export function createAuthRouter(options) {
  const {
    authService,
    requireAuth,
    requireCsrf,
    cookieName,
    cookieOptions,
    loginLimiter,
    registerLimiter
  } = options;
  const router = Router();

  function setSessionCookie(res, session) {
    const maxAge = Math.max(new Date(session.expiresAt).getTime() - Date.now(), 0);
    res.cookie(cookieName, session.token, {
      ...cookieOptions,
      httpOnly: true,
      maxAge,
      path: '/'
    });
  }

  function clearSessionCookie(res) {
    res.clearCookie(cookieName, {
      ...cookieOptions,
      httpOnly: true,
      path: '/'
    });
  }

  router.get('/status', (_req, res) => {
    res.json({ bootstrapRequired: authService.bootstrapRequired() });
  });

  router.post(
    '/register',
    registerLimiter,
    validate({ body: registerSchema }),
    asyncHandler(async (req, res) => {
      if (authService.bootstrapRequired() && !isLoopbackRequest(req)) {
        throw forbidden(
          'A primeira conta administrativa deve ser criada diretamente no computador do servidor.',
          'BOOTSTRAP_LOCAL_NECESSARIO'
        );
      }
      const result = await authService.register(req.validated.body, req);
      setSessionCookie(res, result);
      res.status(201).json({
        user: result.user,
        csrfToken: result.csrfToken,
        bootstrapCompleted: result.isFirstUser
      });
    })
  );

  router.post(
    '/login',
    loginLimiter,
    validate({ body: loginSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.login(req.validated.body, req);
      setSessionCookie(res, result);
      res.json({ user: result.user, csrfToken: result.csrfToken });
    })
  );

  router.get('/me', requireAuth, (req, res) => {
    res.json(req.user);
  });

  router.get('/csrf', requireAuth, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ csrfToken: authService.csrfForSession(req.authSession.id) });
  });

  router.post(
    '/reauthenticate',
    requireAuth,
    requireCsrf,
    validate({ body: reauthenticateSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.reauthenticate(
        req.user.id,
        req.authSession.id,
        req.validated.body.password,
        req
      );
      res.json(result);
    })
  );

  router.post('/logout', requireAuth, requireCsrf, (req, res) => {
    authService.logout(req.authSession.id, req, req.user.id);
    clearSessionCookie(res);
    res.status(204).end();
  });

  return router;
}
