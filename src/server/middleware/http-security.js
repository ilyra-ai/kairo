// ============================================================================
// Kairo — Cabeçalhos, CSP, CORS e políticas de requisição
// ============================================================================

import cors from 'cors';
import helmet from 'helmet';
import { badRequest, forbidden } from '../shared/http-error.js';

function requestOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

export function createCorsMiddleware(allowedOrigins = []) {
  const configured = new Set(allowedOrigins);

  return cors((req, callback) => {
    const origin = req.get('origin');
    const allowed = !origin || origin === requestOrigin(req) || configured.has(origin);
    callback(null, {
      origin: allowed,
      credentials: allowed,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600
    });
  });
}

export function rejectDisallowedOrigin(allowedOrigins = []) {
  const configured = new Set(allowedOrigins);

  return function originGuard(req, _res, next) {
    const origin = req.get('origin');
    if (!origin || origin === requestOrigin(req) || configured.has(origin)) return next();
    next(forbidden('A origem desta requisição não é permitida.', 'ORIGEM_NAO_PERMITIDA'));
  };
}

export function createHelmetMiddleware({ isProduction }) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        upgradeInsecureRequests: isProduction ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false
  });
}

export function additionalSecurityHeaders(_req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
}

export function apiNoStore(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

export function requireJsonBody(req, _res, next) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
    if (hasBody && !req.is('application/json')) {
      return next(badRequest('Esta rota aceita somente conteúdo JSON.', 'CONTENT_TYPE_INVALIDO'));
    }
  }
  next();
}
