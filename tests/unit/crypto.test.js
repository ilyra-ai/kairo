// ============================================================================
// Kairo — Testes unitários da criptografia autenticada
// ============================================================================

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  decryptString,
  encryptString,
  loadEncryptionKey,
  loadSessionSecret,
  normalizeEncryptionKey,
  normalizeSessionSecret
} from '../../src/server/security/crypto.js';

describe('criptografia AES-256-GCM', () => {
  it('preserva integralmente texto UTF-8 no ciclo de criptografia e descriptografia', () => {
    const key = randomBytes(32);
    const aad = 'google-token:usuario:42';
    const plaintext = 'segredo real — ação, coração e 🔐';

    const encrypted = encryptString(plaintext, { key, aad });
    const decrypted = decryptString(encrypted, { key, aad });

    assert.match(encrypted, /^kairo:v1:/);
    assert.notEqual(encrypted, plaintext);
    assert.equal(decrypted, plaintext);
  });

  it('rejeita conteúdo adulterado sem devolver qualquer fragmento do texto original', () => {
    const key = randomBytes(32);
    const aad = 'memoria:usuario:9';
    const encrypted = encryptString('conteúdo privado', { key, aad });
    const parts = encrypted.split(':');
    const ciphertext = Buffer.from(parts[4], 'base64url');
    ciphertext[0] ^= 0x01;
    parts[4] = ciphertext.toString('base64url');

    assert.throws(
      () => decryptString(parts.join(':'), { key, aad }),
      /integridade ou contexto inválido/
    );
  });

  it('rejeita o mesmo conteúdo quando o AAD pertence a outro contexto', () => {
    const key = randomBytes(32);
    const encrypted = encryptString('token por usuário', {
      key,
      aad: 'google-token:usuario:10'
    });

    assert.throws(
      () => decryptString(encrypted, {
        key,
        aad: 'google-token:usuario:11'
      }),
      /integridade ou contexto inválido/
    );
  });

  it('exige AAD não vazio nas duas operações', () => {
    const key = randomBytes(32);

    assert.throws(
      () => encryptString('segredo', { key, aad: '' }),
      /AAD.*obrigatório/
    );
    assert.throws(
      () => decryptString('kairo:v1:inválido', { key, aad: '' }),
      /AAD.*obrigatório/
    );
  });

  it('valida os tamanhos mínimos dos segredos e da chave AES-256', () => {
    assert.equal(normalizeSessionSecret(randomBytes(32)).length, 32);
    assert.equal(normalizeEncryptionKey(randomBytes(32)).length, 32);
    assert.throws(
      () => normalizeSessionSecret(randomBytes(31)),
      /no mínimo 32 bytes/
    );
    assert.throws(
      () => normalizeEncryptionKey(randomBytes(31)),
      /exatamente 32 bytes/
    );
  });
});

describe('gestão local de segredos', () => {
  it('gera uma única vez, persiste fora do banco e recarrega o mesmo material', () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'kairo-crypto-'));
    const sessionFile = path.join(temporaryDirectory, 'session.key');
    const encryptionFile = path.join(temporaryDirectory, 'encryption.key');

    try {
      const firstSessionSecret = loadSessionSecret({ value: '', filename: sessionFile });
      const secondSessionSecret = loadSessionSecret({ value: '', filename: sessionFile });
      const firstEncryptionKey = loadEncryptionKey({ value: '', filename: encryptionFile });
      const secondEncryptionKey = loadEncryptionKey({ value: '', filename: encryptionFile });

      assert.equal(firstSessionSecret.length, 48);
      assert.equal(firstEncryptionKey.length, 32);
      assert.deepEqual(secondSessionSecret, firstSessionSecret);
      assert.deepEqual(secondEncryptionKey, firstEncryptionKey);
      assert.match(readFileSync(sessionFile, 'utf8'), /^base64:[A-Za-z0-9+/]+=*\n$/);
      assert.match(readFileSync(encryptionFile, 'utf8'), /^base64:[A-Za-z0-9+/]+=*\n$/);

      if (process.platform !== 'win32') {
        assert.equal(statSync(sessionFile).mode & 0o077, 0);
        assert.equal(statSync(encryptionFile).mode & 0o077, 0);
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
