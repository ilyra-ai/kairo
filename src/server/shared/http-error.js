// ============================================================================
// Kairo — Erros HTTP tipados e seguros para resposta pública
// ============================================================================

export class HttpError extends Error {
  constructor(status, code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? status < 500;
  }
}

export function badRequest(
  message = 'Requisição inválida.',
  code = 'REQUISICAO_INVALIDA',
  details
) {
  return new HttpError(400, code, message, { details });
}

export function unauthorized(message = 'Autenticação necessária.', code = 'NAO_AUTENTICADO') {
  return new HttpError(401, code, message);
}

export function forbidden(
  message = 'Você não possui permissão para esta ação.',
  code = 'ACESSO_NEGADO'
) {
  return new HttpError(403, code, message);
}

export function notFound(message = 'Recurso não encontrado.', code = 'NAO_ENCONTRADO') {
  return new HttpError(404, code, message);
}

export function conflict(message = 'A operação conflita com o estado atual.', code = 'CONFLITO') {
  return new HttpError(409, code, message);
}

export function unprocessable(
  message = 'Os dados informados não são válidos.',
  code = 'DADOS_INVALIDOS',
  details
) {
  return new HttpError(422, code, message, { details });
}

export function tooManyRequests(
  message = 'Muitas tentativas. Aguarde e tente novamente.',
  code = 'LIMITE_EXCEDIDO'
) {
  return new HttpError(429, code, message);
}

export function internalError(cause) {
  return new HttpError(500, 'ERRO_INTERNO', 'Não foi possível concluir a operação.', {
    cause,
    expose: false
  });
}

export function assertCondition(condition, error) {
  if (!condition) throw error;
}

export function isHttpError(error) {
  return error instanceof HttpError;
}
