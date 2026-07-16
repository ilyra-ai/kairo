// ============================================================================
// Kairo — Validação central de entrada HTTP
// ============================================================================

import { ZodError } from 'zod';
import { unprocessable } from '../shared/http-error.js';

function formatIssues(error) {
  return error.issues.map((issue) => ({
    campo: issue.path.length > 0 ? issue.path.join('.') : 'requisição',
    mensagem: issue.message
  }));
}

export function validate(schemas = {}) {
  return function validationMiddleware(req, _res, next) {
    try {
      const validated = {};

      if (schemas.params) validated.params = schemas.params.parse(req.params);
      if (schemas.query) validated.query = schemas.query.parse(req.query);
      if (schemas.body) validated.body = schemas.body.parse(req.body);

      req.validated = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return next(unprocessable(
          'Revise os campos informados.',
          'VALIDACAO_FALHOU',
          formatIssues(error)
        ));
      }
      next(error);
    }
  };
}

export function asyncHandler(handler) {
  return function handledRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
