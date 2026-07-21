// ============================================================================
// Kairo — Integração do gateway de provedores de IA (Tarefa 15)
// ----------------------------------------------------------------------------
// Rede simulada por `fetch` injetável (a lógica do gateway é real); prova SSRF,
// segredo oculto, timeout/cancelamento, desativação, descoberta, capability-check
// e roteamento por capacidade.
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { openSqliteClient } from '../../src/server/database/index.js';
import { ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { createAiService } from '../../src/server/modules/ai/ai.service.js';

const ENCRYPTION_KEY = randomBytes(32);

// Resolver de DNS injetável: mapeia hosts de teste para IPs previsíveis.
const RESOLVER = async (host) => {
  const mapa = {
    'provedor-remoto.example.com': ['203.0.113.10'],
    'rebinding.example.com': ['10.0.0.5'],
    'openai.example.com': ['203.0.113.20']
  };
  return mapa[host] || ['203.0.113.99'];
};

function criarContexto(t, { fetchImpl } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-ia-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db); // cria a tabela users (FK created_by)
  db.run(
    `INSERT INTO users (name, email, password_hash, role, plan)
     VALUES ('Admin', 'admin@kairo.local', 'hash', 'administrador', 'pro')`
  );
  const service = createAiService({
    db,
    encryptionKey: ENCRYPTION_KEY,
    fetchImpl: fetchImpl || (async () => jsonResponse({})),
    resolver: RESOLVER,
    remoteAllowlist: [],
    defaultTimeoutMs: 150, // timeouts curtos para o teste ser rápido e determinístico
    defaultMaxRetries: 0
  });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, service };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

test('cria conexão local, oculta o segredo e permite descobrir modelos reais', async (t) => {
  // fetch simulado: /api/tags (ollama) devolve dois modelos.
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return jsonResponse({
        models: [
          { model: 'gemma3:latest', name: 'gemma3:latest', details: { families: ['gemma'] } },
          { model: 'llama3:8b', name: 'llama3:8b' }
        ]
      });
    }
    return jsonResponse({}, 404);
  };
  const { service } = criarContexto(t, { fetchImpl });

  const conexao = await service.createConnection(
    {
      name: 'Ollama local',
      provider_type: 'ollama',
      base_url: 'http://127.0.0.1:11434',
      api_key: 'chave-super-secreta'
    },
    1
  );
  assert.equal(conexao.provider_type, 'ollama');
  assert.equal(conexao.is_local, true);
  assert.equal(conexao.has_api_key, true);
  // O segredo NUNCA aparece em texto claro na serialização.
  assert.equal(conexao.api_key, undefined);
  assert.equal(conexao.encrypted_api_key, undefined);

  const modelos = await service.discoverModels(conexao.id);
  assert.equal(modelos.length, 2);
  assert.ok(modelos.some((m) => m.model_id === 'gemma3:latest'));
  // Capacidades permanecem desconhecidas até um capability-check real.
  assert.equal(modelos[0].capabilities.tool_calling, null);
});

test('SSRF: bloqueia metadados de nuvem e host interno remoto; permite LAN local', async (t) => {
  const { service } = criarContexto(t);

  // Metadados de nuvem — sempre bloqueado.
  await assert.rejects(
    service.createConnection(
      { name: 'meta', provider_type: 'openai-compatible', base_url: 'http://169.254.169.254' },
      1
    ),
    (erro) => erro.code === 'HOST_BLOQUEADO'
  );

  // Remoto (não-local) apontando para IP interno — bloqueado.
  await assert.rejects(
    service.createConnection(
      {
        name: 'interno',
        provider_type: 'openai-compatible',
        base_url: 'http://10.0.0.5:1234',
        is_local: false
      },
      1
    ),
    (erro) => erro.code === 'HOST_BLOQUEADO'
  );

  // Remoto público sem allowlist — bloqueado.
  await assert.rejects(
    service.createConnection(
      {
        name: 'remoto',
        provider_type: 'openai-compatible',
        base_url: 'https://provedor-remoto.example.com/v1',
        is_local: false
      },
      1
    ),
    (erro) => erro.code === 'HOST_BLOQUEADO'
  );

  // LM Studio na LAN (192.168.x) como local — permitido.
  const lan = await service.createConnection(
    { name: 'LM Studio', provider_type: 'lmstudio', base_url: 'http://192.168.0.8:1234' },
    1
  );
  assert.equal(lan.is_local, true);
});

test('host remoto só passa com allow_remote_host explícito', async (t) => {
  const fetchImpl = async () => jsonResponse({ data: [{ id: 'gpt-x' }] });
  const { service } = criarContexto(t, { fetchImpl });

  const conexao = await service.createConnection(
    {
      name: 'OpenAI',
      provider_type: 'openai-compatible',
      base_url: 'https://openai.example.com/v1',
      api_key: 'sk-teste',
      is_local: false,
      allow_remote_host: true
    },
    1
  );
  assert.equal(conexao.allow_remote_host, true);
  const teste = await service.testConnection(conexao.id);
  assert.equal(teste.ok, true);
  assert.equal(teste.health_status, 'ok');
});

test('falha de serviço local marca offline e nunca "ok"', async (t) => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  const { service } = criarContexto(t, { fetchImpl });
  const conexao = await service.createConnection(
    { name: 'Ollama caído', provider_type: 'ollama', base_url: 'http://127.0.0.1:11434' },
    1
  );
  const resultado = await service.testConnection(conexao.id);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.health_status, 'offline');
  assert.equal(service.getConnection(conexao.id).health_status, 'offline');
});

test('timeout é respeitado quando o provedor não responde a tempo', async (t) => {
  const fetchImpl = (url, init) =>
    new Promise((_resolve, reject) => {
      // Nunca resolve; só rejeita quando o AbortController abortar.
      init.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    });
  const { service } = criarContexto(t, { fetchImpl });
  // Reduz o timeout via monkey-patch do serviço não é possível; usamos o real,
  // mas o teste confirma que o abort de timeout produz status offline honesto.
  const conexao = await service.createConnection(
    { name: 'Lento', provider_type: 'ollama', base_url: 'http://127.0.0.1:11434' },
    1
  );
  const resultado = await service.testConnection(conexao.id);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.health_status, 'offline');
  assert.match(String(resultado.error_code), /TIMEOUT|REDE/);
});

test('capability-check confirma chat e tool calling por probe real; trava ações sem tool calling', async (t) => {
  // fetch simulado por endpoint: tags, chat sem tools (texto), chat com tools (tool_calls), embeddings.
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/api/tags')) {
      return jsonResponse({ models: [{ model: 'gemma3:latest', name: 'gemma3:latest' }] });
    }
    if (u.endsWith('/api/chat')) {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.tools)) {
        return jsonResponse({
          message: { content: '', tool_calls: [{ function: { name: 'kairo_ping' } }] }
        });
      }
      return jsonResponse({ message: { content: 'ok' } });
    }
    if (u.endsWith('/api/embed')) {
      return jsonResponse({ embeddings: [[0.1, 0.2, 0.3]] });
    }
    return jsonResponse({}, 404);
  };
  const { service } = criarContexto(t, { fetchImpl });
  const conexao = await service.createConnection(
    { name: 'Ollama', provider_type: 'ollama', base_url: 'http://127.0.0.1:11434' },
    1
  );
  const modelos = await service.discoverModels(conexao.id);
  const modelo = modelos[0];

  const checado = await service.capabilityCheck(modelo.id);
  assert.equal(checado.capabilities.chat, true);
  assert.equal(checado.capabilities.tool_calling, true);
  assert.equal(checado.capabilities.embeddings, true);

  // Roteamento por capacidade encontra o modelo com tool calling confirmado.
  const roteado = service.resolveForCapability('tool_calling');
  assert.equal(roteado.id, modelo.id);
  // Trava de ação destrutiva não lança para modelo capaz.
  assert.doesNotThrow(() => service.assertToolCapable(modelo.id));
});

test('desativar a conexão interrompe o roteamento por capacidade imediatamente', async (t) => {
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/api/tags')) return jsonResponse({ models: [{ model: 'm1', name: 'm1' }] });
    if (u.endsWith('/api/chat')) {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.tools)) {
        return jsonResponse({
          message: { content: '', tool_calls: [{ function: { name: 'x' } }] }
        });
      }
      return jsonResponse({ message: { content: 'ok' } });
    }
    if (u.endsWith('/api/embed')) return jsonResponse({ embeddings: [[1]] });
    return jsonResponse({}, 404);
  };
  const { service } = criarContexto(t, { fetchImpl });
  const conexao = await service.createConnection(
    { name: 'Ollama', provider_type: 'ollama', base_url: 'http://127.0.0.1:11434' },
    1
  );
  const [modelo] = await service.discoverModels(conexao.id);
  await service.capabilityCheck(modelo.id);
  assert.ok(service.resolveForCapability('chat'), 'ativa deve rotear');

  await service.updateConnection(conexao.id, { is_active: false });
  assert.equal(service.resolveForCapability('chat'), null, 'inativa não pode ser roteada');
});

test('atualizar sem nova chave mantém o segredo; enviar null remove', async (t) => {
  const { service, db } = criarContexto(t);
  const conexao = await service.createConnection(
    {
      name: 'OpenAI',
      provider_type: 'openai-compatible',
      base_url: 'https://openai.example.com/v1',
      api_key: 'sk-original',
      is_local: false,
      allow_remote_host: true
    },
    1
  );
  // Sem api_key no update → segredo mantido.
  await service.updateConnection(conexao.id, { name: 'OpenAI Renomeado' });
  assert.equal(service.getConnection(conexao.id).has_api_key, true);
  const cifradoAntes = db.get('SELECT encrypted_api_key FROM ai_connections WHERE id = ?', [
    conexao.id
  ]).encrypted_api_key;
  assert.ok(cifradoAntes && !cifradoAntes.includes('sk-original'), 'segredo permanece cifrado');

  // api_key: null → remove.
  await service.updateConnection(conexao.id, { api_key: null });
  assert.equal(service.getConnection(conexao.id).has_api_key, false);
});
