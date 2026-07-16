// ============================================================================
// Kairo — Criptografia autenticada e gestão local de segredos
// ============================================================================

import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from 'node:crypto';
import {
  ENCRYPTION_KEY_FILE,
  SESSION_SECRET_FILE
} from '../config/paths.js';

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_PREFIX = 'kairo:v1';
const AES_KEY_BYTES = 32;
const SESSION_SECRET_BYTES = 48;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function decodeBase64(value, label) {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} em base64 é inválido.`);
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  const decoded = Buffer.from(`${normalized}${'='.repeat(padding)}`, 'base64');
  const canonicalInput = normalized.replace(/=+$/, '');
  const canonicalDecoded = decoded.toString('base64').replace(/=+$/, '');

  if (decoded.length === 0 || canonicalInput !== canonicalDecoded) {
    throw new Error(`${label} em base64 é inválido.`);
  }

  return decoded;
}

function decodeConfiguredSecret(value, label) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} precisa ser uma string ou um Buffer não vazio.`);
  }

  if (value.startsWith('base64:')) {
    return decodeBase64(value.slice('base64:'.length), label);
  }

  if (value.startsWith('hex:')) {
    const hexadecimal = value.slice('hex:'.length);
    if (!/^[a-fA-F0-9]+$/.test(hexadecimal) || hexadecimal.length % 2 !== 0) {
      throw new Error(`${label} em hexadecimal é inválido.`);
    }
    return Buffer.from(hexadecimal, 'hex');
  }

  return Buffer.from(value, 'utf8');
}

export function normalizeSessionSecret(value) {
  const secret = decodeConfiguredSecret(value, 'O segredo de sessão');
  if (secret.length < 32) {
    throw new Error('O segredo de sessão precisa ter no mínimo 32 bytes.');
  }
  return secret;
}

export function normalizeEncryptionKey(value) {
  const key = decodeConfiguredSecret(value, 'A chave de criptografia');
  if (key.length !== AES_KEY_BYTES) {
    throw new Error('A chave de criptografia AES-256 precisa ter exatamente 32 bytes.');
  }
  return key;
}

function restrictFilePermissions(filename) {
  try {
    chmodSync(filename, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
}

function readSecretFile(filename, normalizer, label) {
  try {
    const metadata = lstatSync(filename);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('O caminho do segredo não corresponde a um arquivo local regular.');
    }

    const content = readFileSync(filename, 'utf8').trim();
    return normalizer(content);
  } catch (error) {
    throw new Error(`Não foi possível carregar ${label} do armazenamento local seguro.`, {
      cause: error
    });
  }
}

function createSecretFile(filename, byteLength, normalizer, label) {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const generated = randomBytes(byteLength);
  const serialized = `base64:${generated.toString('base64')}\n`;
  let descriptor;

  try {
    descriptor = openSync(filename, 'wx', 0o600);
    writeFileSync(descriptor, serialized, { encoding: 'utf8' });
    closeSync(descriptor);
    descriptor = undefined;
    restrictFilePermissions(filename);
    return normalizer(generated);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);

    if (error.code === 'EEXIST') {
      restrictFilePermissions(filename);
      return readSecretFile(filename, normalizer, label);
    }

    throw new Error(`Não foi possível criar ${label} no armazenamento local seguro.`, {
      cause: error
    });
  } finally {
    generated.fill(0);
  }
}

function loadOrCreateSecret({ configuredValue, filename, byteLength, normalizer, label }) {
  if (configuredValue !== undefined && configuredValue !== null && configuredValue !== '') {
    return normalizer(configuredValue);
  }

  if (existsSync(filename)) {
    restrictFilePermissions(filename);
    return readSecretFile(filename, normalizer, label);
  }

  return createSecretFile(filename, byteLength, normalizer, label);
}

export function loadSessionSecret({
  value = process.env.SESSION_SECRET,
  filename = SESSION_SECRET_FILE
} = {}) {
  return loadOrCreateSecret({
    configuredValue: value,
    filename,
    byteLength: SESSION_SECRET_BYTES,
    normalizer: normalizeSessionSecret,
    label: 'o segredo de sessão'
  });
}

export function loadEncryptionKey({
  value = process.env.ENCRYPTION_KEY,
  filename = ENCRYPTION_KEY_FILE
} = {}) {
  return loadOrCreateSecret({
    configuredValue: value,
    filename,
    byteLength: AES_KEY_BYTES,
    normalizer: normalizeEncryptionKey,
    label: 'a chave de criptografia'
  });
}

function normalizeAdditionalAuthenticatedData(aad) {
  const value = Buffer.isBuffer(aad)
    ? Buffer.from(aad)
    : aad instanceof Uint8Array
      ? Buffer.from(aad)
      : typeof aad === 'string'
        ? Buffer.from(aad, 'utf8')
        : null;

  if (!value || value.length === 0) {
    throw new Error('O contexto autenticado (AAD) é obrigatório e não pode ser vazio.');
  }

  return value;
}

function encodeEnvelopePart(value) {
  return value.toString('base64url');
}

function decodeEnvelopePart(value, expectedBytes, label) {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error(`O campo ${label} do conteúdo criptografado é inválido.`);
  }

  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== expectedBytes || encodeEnvelopePart(decoded) !== value) {
    throw new Error(`O campo ${label} do conteúdo criptografado é inválido.`);
  }

  return decoded;
}

function parseEnvelope(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('O conteúdo criptografado precisa ser uma string não vazia.');
  }

  const parts = payload.split(':');
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== ENVELOPE_PREFIX) {
    throw new Error('A versão ou o formato do conteúdo criptografado não é suportado.');
  }

  const iv = decodeEnvelopePart(parts[2], IV_BYTES, 'iv');
  const authTag = decodeEnvelopePart(parts[3], AUTH_TAG_BYTES, 'tag');

  if (!BASE64URL_PATTERN.test(parts[4])) {
    throw new Error('O campo dados do conteúdo criptografado é inválido.');
  }

  const ciphertext = Buffer.from(parts[4], 'base64url');
  if (ciphertext.length === 0 || encodeEnvelopePart(ciphertext) !== parts[4]) {
    throw new Error('O campo dados do conteúdo criptografado é inválido.');
  }

  return { iv, authTag, ciphertext };
}

/**
 * Criptografa texto com AES-256-GCM e vincula o resultado ao AAD informado.
 */
export function encryptString(plaintext, {
  aad,
  key = loadEncryptionKey()
} = {}) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('O valor a criptografar precisa ser uma string não vazia.');
  }

  const encryptionKey = normalizeEncryptionKey(key);
  const authenticatedData = normalizeAdditionalAuthenticatedData(aad);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv, {
    authTagLength: AUTH_TAG_BYTES
  });

  cipher.setAAD(authenticatedData);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENVELOPE_PREFIX,
    encodeEnvelopePart(iv),
    encodeEnvelopePart(authTag),
    encodeEnvelopePart(ciphertext)
  ].join(':');
}

/**
 * Descriptografa somente quando chave, envelope e AAD forem autênticos.
 */
export function decryptString(payload, {
  aad,
  key = loadEncryptionKey()
} = {}) {
  const encryptionKey = normalizeEncryptionKey(key);
  const authenticatedData = normalizeAdditionalAuthenticatedData(aad);
  const { iv, authTag, ciphertext } = parseEnvelope(payload);

  try {
    const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv, {
      authTagLength: AUTH_TAG_BYTES
    });
    decipher.setAAD(authenticatedData);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    throw new Error('Não foi possível descriptografar o conteúdo: integridade ou contexto inválido.', {
      cause: error
    });
  }
}

export const encryptSensitiveValue = encryptString;
export const decryptSensitiveValue = decryptString;
