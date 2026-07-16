// ============================================================================
// Kairo — Autenticação, autorização, CSRF e autenticação recente
// ============================================================================

import { forbidden } from '../shared/http-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createAuthenticationMiddleware({ authService, cookieName }) {
  if (!authService) throw new Error('O serviço de autenticação é obrigatório.');
  if (!cookieName) throw new Error('O nome do cookie de sessão é obrigatório.');

  function requireAuth(req, _res, next) {
    try {
      const token = req.cookies?.[cookieName];
      const authenticated = authService.authenticate(token);
      req.user = authenticated.user;
      req.authSession = authenticated.session;
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireAdmin(req, _res, next) {
    if (req.user?.role !== 'administrador') {
      return next(forbidden('Acesso restrito a administradores.', 'ADMINISTRADOR_NECESSARIO'));
    }
    next();
  }

  function requireCsrf(req, _res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const token = req.get('x-csrf-token');
    if (!authService.verifyCsrf(req.authSession?.id, token)) {
      return next(
        forbidden('O token de segurança da requisição é inválido ou expirou.', 'CSRF_INVALIDO')
      );
    }
    next();
  }

  function requireRecentAuth(req, _res, next) {
    if (!authService.hasRecentAuthentication(req.authSession)) {
      return next(
        forbidden(
          'Confirme sua senha novamente para concluir esta operação sensível.',
          'REAUTENTICACAO_NECESSARIA'
        )
      );
    }
    next();
  }

  return { requireAuth, requireAdmin, requireCsrf, requireRecentAuth };
}
