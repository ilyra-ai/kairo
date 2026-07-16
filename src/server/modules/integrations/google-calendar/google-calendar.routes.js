// ============================================================================
// Kairo — Rotas protegidas da integração Google Agenda
// ============================================================================

import { Router } from 'express';
import { asyncHandler, validate } from '../../../middleware/validation.js';
import {
  googleAuthorizationBodySchema,
  googleCallbackQuerySchema,
  googleDisconnectBodySchema,
  googleSyncBodySchema
} from './google-calendar.schemas.js';

function safeInternalPath(value, fallback) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    return fallback;
  }
  return value;
}

function resultRedirect(basePath, result, code) {
  const separator = basePath.includes('?') ? '&' : '?';
  const parameters = new URLSearchParams({ google: result });
  if (code) parameters.set('codigo', code);
  return `${basePath}${separator}${parameters.toString()}`;
}

function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{3,80}$/.test(error.code)
    ? error.code
    : 'GOOGLE_CALLBACK_FALHOU';
}

export function createGoogleCalendarRouter(options = {}) {
  const {
    googleCalendarService,
    authService,
    requireAuth,
    requireCsrf,
    requireRecentAuth,
    mutationLimiter,
    sensitiveLimiter = mutationLimiter,
    successRedirect = '/',
    errorRedirect = '/'
  } = options;

  if (!googleCalendarService) throw new Error('O serviço Google Agenda é obrigatório.');
  if (!authService) throw new Error('O serviço de auditoria de autenticação é obrigatório.');
  for (const [name, middleware] of Object.entries({
    requireAuth,
    requireCsrf,
    requireRecentAuth,
    mutationLimiter,
    sensitiveLimiter
  })) {
    if (typeof middleware !== 'function') {
      throw new TypeError(`O middleware ${name} é obrigatório para as rotas Google.`);
    }
  }

  const router = Router();
  const safeSuccessRedirect = safeInternalPath(successRedirect, '/');
  const safeErrorRedirect = safeInternalPath(errorRedirect, '/');

  router.use(requireAuth);

  router.get('/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(googleCalendarService.getStatus(req.user.id));
  });

  router.post(
    '/auth',
    sensitiveLimiter,
    requireCsrf,
    requireRecentAuth,
    validate({ body: googleAuthorizationBodySchema }),
    (req, res) => {
      const authorization = googleCalendarService.createAuthorization(
        req.user.id,
        req.authSession.id
      );
      authService.audit({
        action: 'google.authorization.start',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(authorization);
    }
  );

  router.get(
    '/callback',
    sensitiveLimiter,
    requireRecentAuth,
    validate({ query: googleCallbackQuerySchema }),
    async (req, res, next) => {
      try {
        await googleCalendarService.handleCallback(
          req.user.id,
          req.authSession.id,
          req.validated.query
        );
        authService.audit({
          action: 'google.authorization.callback',
          result: 'sucesso',
          actorUserId: req.user.id,
          targetUserId: req.user.id,
          request: req
        });
        res.redirect(303, resultRedirect(safeSuccessRedirect, 'conectado'));
      } catch (error) {
        const errorCode = safeErrorCode(error);
        authService.audit({
          action: 'google.authorization.callback',
          result: 'falha',
          actorUserId: req.user.id,
          targetUserId: req.user.id,
          request: req,
          metadata: { codigo: errorCode }
        });

        if (res.headersSent) return next(error);
        return res.redirect(303, resultRedirect(safeErrorRedirect, 'erro', errorCode));
      }
    }
  );

  router.post(
    '/sync',
    mutationLimiter,
    requireCsrf,
    requireRecentAuth,
    validate({ body: googleSyncBodySchema }),
    asyncHandler(async (req, res) => {
      const stats = await googleCalendarService.syncNow(req.user.id, req.validated.body);
      authService.audit({
        action: 'google.calendar.sync',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: stats
      });
      res.json({
        message: 'Google Agenda sincronizado com sucesso.',
        ...stats
      });
    })
  );

  router.post(
    '/disconnect',
    sensitiveLimiter,
    requireCsrf,
    requireRecentAuth,
    validate({ body: googleDisconnectBodySchema }),
    asyncHandler(async (req, res) => {
      await googleCalendarService.disconnect(req.user.id);
      authService.audit({
        action: 'google.authorization.disconnect',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req
      });
      res.status(204).end();
    })
  );

  return router;
}
