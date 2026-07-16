// ============================================================================
// Kairo — Limites de requisição por superfície de risco
// ============================================================================

import { rateLimit } from 'express-rate-limit';

function jsonHandler(req, res, _next, options) {
  res.status(options.statusCode).json({
    error: {
      code: 'LIMITE_EXCEDIDO',
      message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
      requestId: req.requestId
    }
  });
}

function limiter(options) {
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ipv6Subnet: 56,
    handler: jsonHandler,
    ...options
  });
}

export function createRateLimiters(config = {}) {
  const windowMs = config.windowMs ?? 15 * 60 * 1000;

  return {
    general: limiter({
      windowMs,
      limit: config.generalLimit ?? 300
    }),
    login: limiter({
      windowMs,
      limit: config.loginLimit ?? 10,
      skipSuccessfulRequests: true
    }),
    register: limiter({
      windowMs: config.registerWindowMs ?? 60 * 60 * 1000,
      limit: config.registerLimit ?? 5
    }),
    mutation: limiter({
      windowMs,
      limit: config.mutationLimit ?? 120
    }),
    sensitive: limiter({
      windowMs: config.sensitiveWindowMs ?? 60 * 60 * 1000,
      limit: config.sensitiveLimit ?? 10
    }),
    ai: limiter({
      windowMs: config.aiWindowMs ?? 60 * 1000,
      limit: config.aiLimit ?? 30
    })
  };
}
