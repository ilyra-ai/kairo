// ============================================================================
// Kairo — Contrato HTTP da superfície estática publicada em /assets
// ============================================================================
//
// Regressão da causa raiz encontrada no QA final de 27/07/2026: o
// express.static é montado com `fallthrough: false`, então um arquivo ausente
// vira um erro tipado do serve-static. Esse erro carrega o status correto, mas
// não é um HttpError do Kairo; sem normalização, o contrato público respondia
// 500 ERRO_INTERNO para qualquer asset inexistente.

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { test } from 'node:test';

import { errorHandler } from '../../src/server/middleware/error-handler.js';

const raizDoProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const diretorioPublico = path.join(raizDoProjeto, 'public');

function montarSuperficieEstatica() {
  const app = express();

  app.use(
    '/assets',
    express.static(path.join(diretorioPublico, 'assets'), {
      dotfiles: 'deny',
      etag: true,
      fallthrough: false,
      index: false,
      redirect: false
    })
  );

  app.use(errorHandler({ logger: { error() {} } }));
  return app;
}

test('asset existente é servido e asset ausente devolve 404 honesto, nunca 500', async () => {
  const app = montarSuperficieEstatica();

  const existente = await request(app).get('/assets/css/app.css');
  assert.equal(existente.status, 200);

  for (const caminho of [
    '/assets/css/app.js',
    '/assets/css/index.html',
    '/assets/nao-existe.css',
    '/assets/js/inexistente.js',
    '/assets/images/ausente.png'
  ]) {
    const resposta = await request(app).get(caminho);
    assert.equal(resposta.status, 404, `${caminho} deveria responder 404`);
    assert.equal(resposta.body.error.code, 'ARQUIVO_NAO_ENCONTRADO');
    assert.equal(resposta.body.error.message, 'O arquivo solicitado não existe.');
  }
});

test('arquivo oculto permanece recusado sem virar erro interno', async () => {
  const resposta = await request(montarSuperficieEstatica()).get('/assets/.env');

  assert.equal(resposta.status, 403);
  assert.equal(resposta.body.error.code, 'ARQUIVO_NAO_PERMITIDO');
});
