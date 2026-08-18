// Kairo — Testes do mapeamento de erros do provedor de IA no handler central.
// Garante que uma AiRequestError não vire 500 opaco e receba status/código claros.
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../../src/server/middleware/error-handler.js';
import { AiRequestError } from '../../src/server/modules/ai/ai.service.js';

function fakeResposta() {
  return {
    statusCode: null,
    corpo: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.corpo = payload;
      return this;
    }
  };
}

function executar(error) {
  const handler = errorHandler({ logger: { error() {} }, isDevelopment: false });
  const req = { requestId: 'teste-req', method: 'POST', originalUrl: '/api/ai/assistant/chat' };
  const res = fakeResposta();
  handler(error, req, res, () => {});
  return res;
}

test('AiRequestError com 429 vira 503 PROVEDOR_IA_INDISPONIVEL', () => {
  const res = executar(new AiRequestError('HTTP_429', 'O provedor respondeu com status 429.', { status: 429 }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.corpo.error.code, 'PROVEDOR_IA_INDISPONIVEL');
  assert.match(res.corpo.error.message, /provedor de IA/i);
});

test('AiRequestError com 503 upstream também vira 503 indisponível', () => {
  const res = executar(new AiRequestError('HTTP_503', 'Indisponível.', { status: 503 }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.corpo.error.code, 'PROVEDOR_IA_INDISPONIVEL');
});

test('AiRequestError com 401 vira 502 PROVEDOR_IA_CREDENCIAL', () => {
  const res = executar(new AiRequestError('HTTP_401', 'Sem autorização.', { status: 401 }));
  assert.equal(res.statusCode, 502);
  assert.equal(res.corpo.error.code, 'PROVEDOR_IA_CREDENCIAL');
});

test('AiRequestError sem status upstream vira 502 PROVEDOR_IA_ERRO', () => {
  const res = executar(new AiRequestError('FALHA', 'Falha genérica do provedor.'));
  assert.equal(res.statusCode, 502);
  assert.equal(res.corpo.error.code, 'PROVEDOR_IA_ERRO');
});

test('Erro comum continua virando 500 ERRO_INTERNO', () => {
  const res = executar(new Error('qualquer'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.corpo.error.code, 'ERRO_INTERNO');
});
