// ============================================================================
// Kairo — Identificação de requisições e tratamento central de erros
// ============================================================================

import crypto from 'node:crypto';
import {
  badRequest,
  conflict,
  forbidden,
  internalError,
  isHttpError,
  notFound,
  unprocessable
} from '../shared/http-error.js';

export function requestIdMiddleware(req, res, next) {
  const provided = req.get('x-request-id');
  const requestId =
    provided && /^[A-Za-z0-9._:-]{8,128}$/.test(provided) ? provided : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

export function apiNotFound(req, _res, next) {
  next(notFound(`A rota ${req.method} ${req.originalUrl} não existe.`, 'ROTA_NAO_ENCONTRADA'));
}

function normalizeError(error) {
  if (isHttpError(error)) return error;

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return badRequest('O corpo JSON da requisição está malformado.', 'JSON_INVALIDO');
  }

  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return conflict('Já existe um registro com esses dados.', 'REGISTRO_DUPLICADO');
  }

  if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return unprocessable(
      'O registro relacionado não existe ou não pertence ao usuário.',
      'RELACAO_INVALIDA'
    );
  }

  if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
    return unprocessable('A operação viola uma regra de integridade.', 'INTEGRIDADE_INVALIDA');
  }

  // serve-static/send sinalizam arquivo ausente, caminho recusado ou requisição
  // malformada com um erro próprio que carrega o status correto mas não é um
  // HttpError do Kairo. Sem esta normalização o contrato público devolveria 500.
  const statusDeBiblioteca = Number(error?.status ?? error?.statusCode);
  if (
    Number.isInteger(statusDeBiblioteca) &&
    statusDeBiblioteca >= 400 &&
    statusDeBiblioteca < 500
  ) {
    if (statusDeBiblioteca === 403) {
      return forbidden('O acesso a este arquivo não é permitido.', 'ARQUIVO_NAO_PERMITIDO');
    }
    if (statusDeBiblioteca === 400) {
      return badRequest('O caminho solicitado é inválido.', 'CAMINHO_INVALIDO');
    }
    return notFound('O arquivo solicitado não existe.', 'ARQUIVO_NAO_ENCONTRADO');
  }

  return internalError(error);
}

export function errorHandler(options = {}) {
  const logger = options.logger ?? console;
  const isDevelopment = options.isDevelopment ?? false;

  return function handleError(error, req, res, next) {
    const normalized = normalizeError(error);

    if (normalized.status >= 500) {
      logger.error({
        evento: 'erro_http',
        requestId: req.requestId,
        metodo: req.method,
        caminho: req.originalUrl,
        codigo: normalized.code,
        erro: error?.message,
        stack: isDevelopment ? error?.stack : undefined
      });
    }

    const payload = {
      error: {
        code: normalized.code,
        message: normalized.expose ? normalized.message : 'Não foi possível concluir a operação.',
        requestId: req.requestId
      }
    };

    if (normalized.expose && normalized.details) {
      payload.error.details = normalized.details;
    }

    if (res.headersSent) return next(error);
    res.status(normalized.status).json(payload);
  };
}
