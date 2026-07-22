// ============================================================================
// Kairo — Casos-limite de segurança, erros HTTP e cliente SQLite
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { openSqliteClient, SqliteClient } from '../../src/server/database/sqlite-client.js';
import { getAdapter } from '../../src/server/modules/ai/ai.adapters.js';
import {
  decryptString,
  encryptString,
  loadEncryptionKey,
  loadSessionSecret,
  normalizeEncryptionKey,
  normalizeSessionSecret
} from '../../src/server/security/crypto.js';
import {
  assertCondition,
  HttpError,
  isHttpError,
  tooManyRequests
} from '../../src/server/shared/http-error.js';

test('normaliza segredos configurados em Buffer, Uint8Array, hexadecimal, base64 e texto', () => {
  const chave = randomBytes(32);
  assert.deepEqual(normalizeEncryptionKey(chave), chave);
  assert.deepEqual(normalizeEncryptionKey(new Uint8Array(chave)), chave);
  assert.deepEqual(normalizeEncryptionKey(`hex:${chave.toString('hex')}`), chave);
  assert.deepEqual(normalizeEncryptionKey(`base64:${chave.toString('base64')}`), chave);
  assert.deepEqual(normalizeSessionSecret('s'.repeat(32)), Buffer.from('s'.repeat(32)));
  assert.deepEqual(loadEncryptionKey({ value: chave }), chave);
  assert.deepEqual(
    loadSessionSecret({ value: new Uint8Array(Buffer.alloc(48, 7)) }),
    Buffer.alloc(48, 7)
  );
});

test('recusa representações não canônicas, vazias ou malformadas de segredos', () => {
  for (const valor of [undefined, '', 42]) {
    assert.throws(() => normalizeEncryptionKey(valor), /string ou um Buffer não vazio/);
  }
  for (const valor of ['base64:!', 'base64:A', 'base64:AA=A', 'hex:xyz', 'hex:abc']) {
    assert.throws(() => normalizeEncryptionKey(valor), /inválid|exatamente 32 bytes/);
  }
});

test('recusa caminho de segredo que não seja arquivo regular e preserva a causa', (t) => {
  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-segredo-invalido-'));
  t.after(() => fs.rmSync(diretorio, { recursive: true, force: true }));

  assert.throws(
    () => loadEncryptionKey({ value: '', filename: diretorio }),
    (error) =>
      /Não foi possível carregar a chave/.test(error.message) &&
      /arquivo local regular/.test(error.cause?.message)
  );
});

test('aceita AAD binário e rejeita texto ou envelopes criptográficos inválidos', () => {
  const key = randomBytes(32);
  const aadBuffer = Buffer.from('contexto');
  const aadTyped = new Uint8Array(aadBuffer);
  const payload = encryptString('segredo', { key, aad: aadBuffer });
  assert.equal(decryptString(payload, { key, aad: aadTyped }), 'segredo');

  assert.throws(() => encryptString('', { key, aad: 'x' }), /string não vazia/);
  assert.throws(() => encryptString(null, { key, aad: 'x' }), /string não vazia/);
  assert.throws(() => encryptString('x', { key, aad: 7 }), /AAD.*obrigatório/);
  assert.throws(() => decryptString('', { key, aad: 'x' }), /string não vazia/);
  assert.throws(() => decryptString(7, { key, aad: 'x' }), /string não vazia/);
  assert.throws(() => decryptString('kairo:v2:a:b:c', { key, aad: 'x' }), /não é suportado/);
  assert.throws(() => decryptString('kairo:v1:!:b:c', { key, aad: 'x' }), /campo iv/);

  const partes = payload.split(':');
  assert.throws(
    () => decryptString(['kairo', 'v1', 'AA', partes[3], partes[4]].join(':'), { key, aad: 'x' }),
    /campo iv/
  );
  assert.throws(
    () =>
      decryptString([partes[0], partes[1], partes[2], '!', partes[4]].join(':'), { key, aad: 'x' }),
    /campo tag/
  );
  assert.throws(
    () =>
      decryptString([partes[0], partes[1], partes[2], partes[3], '!'].join(':'), { key, aad: 'x' }),
    /campo dados/
  );
  assert.throws(
    () =>
      decryptString([partes[0], partes[1], partes[2], partes[3], 'A'].join(':'), { key, aad: 'x' }),
    /campo dados/
  );
});

test('cliente SQLite cobre validações, parâmetros e ciclo de vida real', (t) => {
  assert.throws(() => new SqliteClient(), /caminho do banco SQLite é obrigatório/);
  assert.throws(() => new SqliteClient(7), /caminho do banco SQLite é obrigatório/);

  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-sqlite-edge-'));
  const arquivo = path.join(diretorio, 'dados.sqlite');
  t.after(() => fs.rmSync(diretorio, { recursive: true, force: true }));
  const db = openSqliteClient(arquivo);
  db.exec('CREATE TABLE itens (id INTEGER PRIMARY KEY, nome TEXT NOT NULL)');
  assert.equal(db.run('INSERT INTO itens (nome) VALUES (?)', ['um']).changes, 1);
  assert.equal(db.run('INSERT INTO itens (nome) VALUES (@nome)', { nome: 'dois' }).changes, 1);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM itens').total, 2);
  assert.deepEqual(db.all('SELECT nome FROM itens WHERE id > ?', [0]), [
    { nome: 'um' },
    { nome: 'dois' }
  ]);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.inTransaction, false);
  assert.equal(db.open, true);
  db.close();
  assert.equal(db.open, false);
  assert.doesNotThrow(() => db.close());
});

test('backup SQLite recusa estados inseguros e não sobrescreve arquivos', (t) => {
  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-backup-edge-'));
  const arquivo = path.join(diretorio, 'origem.sqlite');
  const db = openSqliteClient(arquivo);
  t.after(() => {
    db.close();
    fs.rmSync(diretorio, { recursive: true, force: true });
  });
  db.exec('CREATE TABLE itens (id INTEGER PRIMARY KEY)');

  assert.throws(() => db.backupSync(arquivo), /destino do backup precisa ser diferente/);
  const destino = path.join(diretorio, 'backup.sqlite');
  fs.writeFileSync(destino, 'ocupado');
  assert.throws(() => db.backupSync(destino), /backup já existe/);
  assert.throws(
    () => db.transaction((tx) => tx.backupSync(path.join(diretorio, 'durante.sqlite'))),
    /antes de iniciar a transação/
  );
});

test('erros HTTP mantêm contrato e assertCondition cobre sucesso e falha', () => {
  const erro = tooManyRequests();
  assert.equal(erro.status, 429);
  assert.equal(erro.code, 'LIMITE_EXCEDIDO');
  assert.equal(isHttpError(erro), true);
  assert.equal(isHttpError(new Error('comum')), false);
  assert.doesNotThrow(() => assertCondition(true, erro));
  assert.throws(
    () => assertCondition(false, erro),
    (recebido) => recebido === erro
  );

  const interno = new HttpError(500, 'FALHA', 'Falha', { expose: true });
  assert.equal(interno.expose, true);
});

test('adaptadores de IA compõem contratos HTTP nativos sem inferir provedor pela URL', () => {
  assert.throws(() => getAdapter('desconhecido'), /não suportado/);

  const openai = getAdapter('openai-compatible');
  const conexaoOpenAi = { base_url: 'https://api.example.com/', apiKey: 'token' };
  assert.equal(openai.resolveBase(conexaoOpenAi.base_url), 'https://api.example.com/v1');
  assert.match(openai.buildListModelsRequest(conexaoOpenAi).url, /\/v1\/models$/);
  assert.deepEqual(
    openai.parseModels({
      data: [
        { id: 'modelo-a', context_length: 8192, state: 'loaded' },
        { model: 'modelo-b', context_window: 4096, state: 'offline' },
        { id: '' }
      ]
    }),
    [
      { model_id: 'modelo-a', display_name: 'modelo-a', max_context: 8192, loaded: true },
      { model_id: 'modelo-b', display_name: 'modelo-b', max_context: 4096, loaded: false }
    ]
  );
  const chatOpenAi = openai.buildChatRequest(conexaoOpenAi, {
    model: 'modelo-a',
    messages: [{ role: 'user', content: 'Olá' }],
    tools: [{ type: 'function' }],
    responseFormat: { type: 'json_object' },
    stream: true
  });
  assert.equal(JSON.parse(chatOpenAi.init.body).stream, true);
  assert.match(
    openai.buildEmbeddingsRequest(conexaoOpenAi, { model: 'e', input: 'x' }).url,
    /embeddings$/
  );
  assert.equal(
    openai.extractChatText({ choices: [{ message: { content: 'resposta' } }] }),
    'resposta'
  );
  assert.equal(openai.hasToolCalls({ choices: [{ message: { tool_calls: [] } }] }), true);

  const lmstudio = getAdapter('lmstudio');
  const conexaoLm = { base_url: 'http://127.0.0.1:1234/v1' };
  assert.match(lmstudio.buildListModelsRequest(conexaoLm).url, /\/api\/v0\/models$/);
  assert.deepEqual(
    lmstudio.parseModels({ data: [{ id: 'visão', loaded_context_length: 2048, type: 'vlm' }] })[0],
    {
      model_id: 'visão',
      display_name: 'visão',
      max_context: 2048,
      loaded: null,
      declared_vision: true
    }
  );

  const anthropic = getAdapter('anthropic');
  const conexaoAnthropic = { base_url: '', apiKey: 'segredo' };
  assert.equal(anthropic.resolveBase(''), 'https://api.anthropic.com/v1');
  assert.equal(anthropic.anthropicHeaders()['x-api-key'], undefined);
  assert.equal(anthropic.anthropicHeaders('segredo')['x-api-key'], 'segredo');
  assert.match(anthropic.buildListModelsRequest(conexaoAnthropic).url, /\/v1\/models$/);
  assert.deepEqual(
    anthropic.parseModels({ data: [{ id: 'claude', display_name: 'Claude' }, { id: '' }] }),
    [{ model_id: 'claude', display_name: 'Claude', max_context: null, loaded: null }]
  );
  const chatAnthropic = anthropic.buildChatRequest(conexaoAnthropic, {
    model: 'claude',
    messages: [
      { role: 'system', content: 'Seja útil' },
      { role: 'assistant', content: 'Certo' },
      { role: 'user', content: 'Olá' }
    ],
    tools: [{ name: 'agenda' }],
    stream: true
  });
  const corpoAnthropic = JSON.parse(chatAnthropic.init.body);
  assert.equal(corpoAnthropic.system, 'Seja útil');
  assert.equal(corpoAnthropic.messages[0].role, 'assistant');
  assert.equal(corpoAnthropic.stream, true);
  assert.equal(anthropic.buildEmbeddingsRequest(), null);
  assert.equal(
    anthropic.extractChatText({ content: [{ type: 'tool_use' }, { type: 'text', text: 'feito' }] }),
    'feito'
  );
  assert.equal(anthropic.hasToolCalls({ content: [{ type: 'tool_use' }] }), true);
});
