// ============================================================================
// Kairo — Gateway real de provedores de IA (Tarefa 15)
// ----------------------------------------------------------------------------
// Camada única de conexão com modelos remotos e locais. Preserva privacidade
// (segredos criptografados em repouso, nunca devolvidos), evita dependência de
// um único fornecedor (adaptadores explícitos), impede SSRF, e roteia por
// capacidade real confirmada — não por nome. Timeout, cancelamento, retry para
// falhas transitórias e circuit breaker por conexão são de primeira classe.
// ============================================================================

import { conflict, notFound, unprocessable } from '../../shared/http-error.js';
import { decryptString, encryptString } from '../../security/crypto.js';
import {
  CAPABILITY_KEYS,
  LOCAL_PROVIDER_TYPES,
  PROVIDER_TYPES,
  getAdapter
} from './ai.adapters.js';
import { SsrfError, assertSafeAiUrl } from './ai.ssrf.js';

const API_KEY_AAD = 'kairo:ai-connection:api-key';
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 2;
const CIRCUIT_FAILURE_THRESHOLD = 4;
const CIRCUIT_OPEN_MS = 30000;
const MAX_CONCURRENT_REQUESTS = 4;

// ----------------------------------------------------------------------------
// Evolução de schema idempotente
// ----------------------------------------------------------------------------
export function ensureAiSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      encrypted_api_key TEXT,
      is_local INTEGER NOT NULL DEFAULT 0 CHECK (is_local IN (0, 1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      allow_remote_host INTEGER NOT NULL DEFAULT 0 CHECK (allow_remote_host IN (0, 1)),
      health_status TEXT NOT NULL DEFAULT 'desconhecido',
      health_detail TEXT,
      last_health_check_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '{}',
      max_context INTEGER,
      loaded INTEGER,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      last_discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (connection_id, model_id),
      FOREIGN KEY (connection_id) REFERENCES ai_connections (id) ON DELETE CASCADE
    );
  `);
}

function isLocalProvider(providerType) {
  return LOCAL_PROVIDER_TYPES.includes(providerType);
}

function emptyCapabilities() {
  return Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, null]));
}

export function createAiService({
  db,
  encryptionKey,
  fetchImpl = globalThis.fetch,
  resolver = null,
  now = () => new Date(),
  remoteAllowlist = []
} = {}) {
  if (!db) throw new Error('O serviço de IA exige uma instância de banco de dados.');
  ensureAiSchema(db);

  // Estado em memória do circuit breaker e do semáforo de concorrência.
  const circuit = new Map();
  let emExecucao = 0;
  const fila = [];

  function nowIso() {
    return now().toISOString();
  }

  // --------------------------------------------------------------------------
  // Concorrência: semáforo simples para limitar chamadas simultâneas.
  // --------------------------------------------------------------------------
  function adquirirVaga() {
    if (emExecucao < MAX_CONCURRENT_REQUESTS) {
      emExecucao += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => fila.push(resolve));
  }

  function liberarVaga() {
    emExecucao -= 1;
    const proximo = fila.shift();
    if (proximo) {
      emExecucao += 1;
      proximo();
    }
  }

  // --------------------------------------------------------------------------
  // Circuit breaker por conexão
  // --------------------------------------------------------------------------
  function circuitoAberto(connectionId) {
    const estado = circuit.get(connectionId);
    if (!estado) return false;
    if (estado.openUntil && estado.openUntil > now().getTime()) return true;
    if (estado.openUntil && estado.openUntil <= now().getTime()) {
      circuit.set(connectionId, { failures: 0, openUntil: 0 });
    }
    return false;
  }

  function registrarFalha(connectionId) {
    const estado = circuit.get(connectionId) || { failures: 0, openUntil: 0 };
    estado.failures += 1;
    if (estado.failures >= CIRCUIT_FAILURE_THRESHOLD) {
      estado.openUntil = now().getTime() + CIRCUIT_OPEN_MS;
    }
    circuit.set(connectionId, estado);
  }

  function registrarSucesso(connectionId) {
    circuit.set(connectionId, { failures: 0, openUntil: 0 });
  }

  // --------------------------------------------------------------------------
  // Cliente HTTP: timeout + cancelamento + retry transitório + sem redirect
  // --------------------------------------------------------------------------
  function ehFalhaTransitoria(status) {
    return (
      status === 408 ||
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504
    );
  }

  async function executarHttp({
    url,
    init,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    connectionId = null,
    externalSignal = null
  }) {
    if (connectionId !== null && circuitoAberto(connectionId)) {
      throw new AiRequestError(
        'CIRCUITO_ABERTO',
        'A conexão foi temporariamente isolada após falhas consecutivas. Tente novamente em instantes.'
      );
    }

    await adquirirVaga();
    try {
      let ultimaFalha = null;
      for (let tentativa = 0; tentativa <= maxRetries; tentativa += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
        const onExternalAbort = () => controller.abort(new Error('cancelado'));
        if (externalSignal)
          externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        try {
          const resposta = await fetchImpl(url, {
            ...init,
            redirect: 'error',
            signal: controller.signal
          });
          clearTimeout(timer);
          if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);

          if (!resposta.ok) {
            if (ehFalhaTransitoria(resposta.status) && tentativa < maxRetries) {
              ultimaFalha = new AiRequestError(
                'HTTP_' + resposta.status,
                `Resposta transitória ${resposta.status} do provedor.`
              );
              continue;
            }
            if (connectionId !== null) registrarFalha(connectionId);
            const texto = await lerTextoSeguro(resposta);
            throw new AiRequestError(
              'HTTP_' + resposta.status,
              `O provedor respondeu com status ${resposta.status}.`,
              { status: resposta.status, body: texto }
            );
          }

          if (connectionId !== null) registrarSucesso(connectionId);
          return resposta;
        } catch (error) {
          clearTimeout(timer);
          if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
          if (error instanceof AiRequestError) throw error;

          const cancelado = externalSignal?.aborted;
          const abortMsg = String(error?.message || '');
          if (cancelado) {
            throw new AiRequestError('CANCELADO', 'A requisição foi cancelada.');
          }
          if (abortMsg.includes('timeout')) {
            ultimaFalha = new AiRequestError('TIMEOUT', 'A requisição excedeu o tempo limite.');
          } else {
            ultimaFalha = new AiRequestError(
              'REDE',
              `Falha de rede ao contatar o provedor: ${abortMsg}`
            );
          }
          if (tentativa >= maxRetries) {
            if (connectionId !== null) registrarFalha(connectionId);
            throw ultimaFalha;
          }
        }
      }
      if (connectionId !== null) registrarFalha(connectionId);
      throw ultimaFalha || new AiRequestError('REDE', 'Falha desconhecida ao contatar o provedor.');
    } finally {
      liberarVaga();
    }
  }

  async function lerTextoSeguro(resposta) {
    try {
      const texto = await resposta.text();
      return texto.slice(0, 500);
    } catch {
      return '';
    }
  }

  async function lerJson(resposta) {
    try {
      return await resposta.json();
    } catch {
      throw new AiRequestError(
        'RESPOSTA_INVALIDA',
        'O provedor retornou um corpo que não é JSON válido.'
      );
    }
  }

  // --------------------------------------------------------------------------
  // Segredos
  // --------------------------------------------------------------------------
  function cifrarChave(apiKey) {
    if (!apiKey) return null;
    return encryptString(apiKey, { aad: API_KEY_AAD, key: encryptionKey });
  }

  function decifrarChave(encrypted) {
    if (!encrypted) return null;
    try {
      return decryptString(encrypted, { aad: API_KEY_AAD, key: encryptionKey });
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Serialização (NUNCA devolve o segredo em texto claro)
  // --------------------------------------------------------------------------
  function serializeConnection(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      provider_type: row.provider_type,
      base_url: row.base_url,
      is_local: Boolean(row.is_local),
      is_active: Boolean(row.is_active),
      allow_remote_host: Boolean(row.allow_remote_host),
      has_api_key: Boolean(row.encrypted_api_key),
      health_status: row.health_status,
      health_detail: row.health_detail,
      last_health_check_at: row.last_health_check_at,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  function serializeModel(row) {
    if (!row) return null;
    let capabilities = emptyCapabilities();
    try {
      capabilities = { ...emptyCapabilities(), ...JSON.parse(row.capabilities || '{}') };
    } catch {
      /* mantém padrão */
    }
    return {
      id: row.id,
      connection_id: row.connection_id,
      model_id: row.model_id,
      display_name: row.display_name,
      capabilities,
      max_context: row.max_context,
      loaded: row.loaded === null ? null : Boolean(row.loaded),
      is_default: Boolean(row.is_default),
      last_discovered_at: row.last_discovered_at
    };
  }

  function carregarConexaoComSegredo(id) {
    const row = db.get('SELECT * FROM ai_connections WHERE id = ?', [id]);
    if (!row) throw notFound('Conexão de IA não encontrada.', 'CONEXAO_IA_NAO_ENCONTRADA');
    return { row, apiKey: decifrarChave(row.encrypted_api_key) };
  }

  function allowlistDaConexao(row) {
    const base = [...remoteAllowlist];
    if (row?.allow_remote_host && row?.base_url) {
      try {
        base.push(new URL(row.base_url).hostname.toLowerCase());
      } catch {
        /* ignora */
      }
    }
    return base;
  }

  async function validarUrl(baseUrl, { isLocal, allowRemoteHost }) {
    const allowlist = [...remoteAllowlist];
    if (allowRemoteHost) {
      try {
        allowlist.push(new URL(baseUrl).hostname.toLowerCase());
      } catch {
        /* validado a seguir */
      }
    }
    try {
      return await assertSafeAiUrl(baseUrl, { isLocal, allowlist, resolver });
    } catch (error) {
      if (error instanceof SsrfError) {
        throw unprocessable(error.message, 'HOST_BLOQUEADO');
      }
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // CRUD de conexões
  // --------------------------------------------------------------------------
  function validarProviderType(providerType) {
    if (!PROVIDER_TYPES.includes(providerType)) {
      throw unprocessable('Tipo de provedor de IA inválido.', 'PROVIDER_TYPE_INVALIDO');
    }
  }

  async function createConnection(input, actorUserId) {
    validarProviderType(input.provider_type);
    const isLocal =
      input.is_local === undefined ? isLocalProvider(input.provider_type) : Boolean(input.is_local);
    const allowRemoteHost = Boolean(input.allow_remote_host);
    await validarUrl(input.base_url, { isLocal, allowRemoteHost });

    const encrypted = cifrarChave(input.api_key);
    const result = db.run(
      `INSERT INTO ai_connections
        (name, provider_type, base_url, encrypted_api_key, is_local, is_active, allow_remote_host, created_by)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        input.name,
        input.provider_type,
        input.base_url.replace(/\/+$/, ''),
        encrypted,
        isLocal ? 1 : 0,
        allowRemoteHost ? 1 : 0,
        actorUserId ?? null
      ]
    );
    return serializeConnection(
      db.get('SELECT * FROM ai_connections WHERE id = ?', [result.lastID])
    );
  }

  async function updateConnection(id, input) {
    const atual = db.get('SELECT * FROM ai_connections WHERE id = ?', [id]);
    if (!atual) throw notFound('Conexão de IA não encontrada.', 'CONEXAO_IA_NAO_ENCONTRADA');

    const providerType = input.provider_type ?? atual.provider_type;
    validarProviderType(providerType);
    const baseUrl = (input.base_url ?? atual.base_url).replace(/\/+$/, '');
    const isLocal =
      input.is_local === undefined ? Boolean(atual.is_local) : Boolean(input.is_local);
    const allowRemoteHost =
      input.allow_remote_host === undefined
        ? Boolean(atual.allow_remote_host)
        : Boolean(input.allow_remote_host);
    await validarUrl(baseUrl, { isLocal, allowRemoteHost });

    // api_key: string preenchida = substitui; null explícito = remove; ausente = mantém.
    let encrypted = atual.encrypted_api_key;
    if (input.api_key === null) {
      encrypted = null;
    } else if (typeof input.api_key === 'string' && input.api_key.length > 0) {
      encrypted = cifrarChave(input.api_key);
    }

    const isActive =
      input.is_active === undefined ? Boolean(atual.is_active) : Boolean(input.is_active);

    db.run(
      `UPDATE ai_connections
       SET name = ?, provider_type = ?, base_url = ?, encrypted_api_key = ?,
           is_local = ?, is_active = ?, allow_remote_host = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        input.name ?? atual.name,
        providerType,
        baseUrl,
        encrypted,
        isLocal ? 1 : 0,
        isActive ? 1 : 0,
        allowRemoteHost ? 1 : 0,
        id
      ]
    );
    return serializeConnection(db.get('SELECT * FROM ai_connections WHERE id = ?', [id]));
  }

  function deleteConnection(id) {
    const result = db.run('DELETE FROM ai_connections WHERE id = ?', [id]);
    if (result.changes === 0) {
      throw notFound('Conexão de IA não encontrada.', 'CONEXAO_IA_NAO_ENCONTRADA');
    }
  }

  function listConnections() {
    return db
      .all('SELECT * FROM ai_connections ORDER BY id ASC')
      .map((row) => serializeConnection(row));
  }

  function getConnection(id) {
    const row = db.get('SELECT * FROM ai_connections WHERE id = ?', [id]);
    if (!row) throw notFound('Conexão de IA não encontrada.', 'CONEXAO_IA_NAO_ENCONTRADA');
    return serializeConnection(row);
  }

  function atualizarSaude(id, status, detail) {
    db.run(
      `UPDATE ai_connections SET health_status = ?, health_detail = ?, last_health_check_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [status, detail ? String(detail).slice(0, 300) : null, nowIso(), id]
    );
  }

  // --------------------------------------------------------------------------
  // Teste real de conexão (health) — nunca marca como funcional em caso de falha
  // --------------------------------------------------------------------------
  async function testConnection(id) {
    const { row, apiKey } = carregarConexaoComSegredo(id);
    const adapter = getAdapter(row.provider_type);
    const connection = { ...row, apiKey, allowlist: allowlistDaConexao(row) };

    try {
      await validarUrl(row.base_url, {
        isLocal: Boolean(row.is_local),
        allowRemoteHost: Boolean(row.allow_remote_host)
      });
      const { url, init } = adapter.buildListModelsRequest(connection);
      const resposta = await executarHttp({ url, init, connectionId: id });
      const payload = await lerJson(resposta);
      const modelos = adapter.parseModels(payload);
      atualizarSaude(id, 'ok', `Conexão saudável. ${modelos.length} modelo(s) visível(is).`);
      return {
        ok: true,
        health_status: 'ok',
        models_found: modelos.length,
        checked_at: nowIso()
      };
    } catch (error) {
      const code = error?.code || 'FALHA';
      const detalhe = error?.message || 'Falha ao testar a conexão.';
      atualizarSaude(id, 'offline', `${code}: ${detalhe}`);
      return {
        ok: false,
        health_status: 'offline',
        error_code: code,
        error: detalhe,
        checked_at: nowIso()
      };
    }
  }

  // --------------------------------------------------------------------------
  // Descoberta real de modelos
  // --------------------------------------------------------------------------
  async function discoverModels(id) {
    const { row, apiKey } = carregarConexaoComSegredo(id);
    const adapter = getAdapter(row.provider_type);
    const connection = { ...row, apiKey };

    await validarUrl(row.base_url, {
      isLocal: Boolean(row.is_local),
      allowRemoteHost: Boolean(row.allow_remote_host)
    });
    const { url, init } = adapter.buildListModelsRequest(connection);
    const resposta = await executarHttp({ url, init, connectionId: id });
    const payload = await lerJson(resposta);
    const modelos = adapter.parseModels(payload);

    const upsert = db.transaction(() => {
      for (const modelo of modelos) {
        const existente = db.get(
          'SELECT id, capabilities FROM ai_models WHERE connection_id = ? AND model_id = ?',
          [id, modelo.model_id]
        );
        // Capacidades declaradas pelo provedor entram como confirmadas; as demais
        // permanecem desconhecidas até um capability-check real.
        const capacidadesBase = existente
          ? { ...emptyCapabilities(), ...safeParse(existente.capabilities) }
          : emptyCapabilities();
        if (modelo.declared_vision === true) capacidadesBase.vision = true;

        if (existente) {
          db.run(
            `UPDATE ai_models SET display_name = ?, max_context = ?, loaded = ?, capabilities = ?, last_discovered_at = datetime('now')
             WHERE id = ?`,
            [
              modelo.display_name,
              modelo.max_context,
              modelo.loaded === null ? null : modelo.loaded ? 1 : 0,
              JSON.stringify(capacidadesBase),
              existente.id
            ]
          );
        } else {
          db.run(
            `INSERT INTO ai_models (connection_id, model_id, display_name, capabilities, max_context, loaded)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              id,
              modelo.model_id,
              modelo.display_name,
              JSON.stringify(capacidadesBase),
              modelo.max_context,
              modelo.loaded === null ? null : modelo.loaded ? 1 : 0
            ]
          );
        }
      }
    });
    upsert();
    atualizarSaude(id, 'ok', `Descoberta concluída. ${modelos.length} modelo(s).`);
    return listModels({ connection_id: id });
  }

  function listModels(filter = {}) {
    if (filter.connection_id) {
      return db
        .all('SELECT * FROM ai_models WHERE connection_id = ? ORDER BY model_id ASC', [
          filter.connection_id
        ])
        .map((row) => serializeModel(row));
    }
    return db
      .all('SELECT * FROM ai_models ORDER BY connection_id ASC, model_id ASC')
      .map((row) => serializeModel(row));
  }

  function updateModel(id, input) {
    const atual = db.get('SELECT * FROM ai_models WHERE id = ?', [id]);
    if (!atual) throw notFound('Modelo de IA não encontrado.', 'MODELO_IA_NAO_ENCONTRADO');
    if (input.is_default === true) {
      // Apenas um modelo padrão por conexão.
      db.run('UPDATE ai_models SET is_default = 0 WHERE connection_id = ?', [atual.connection_id]);
    }
    db.run(`UPDATE ai_models SET display_name = ?, is_default = ? WHERE id = ?`, [
      input.display_name ?? atual.display_name,
      input.is_default === undefined ? atual.is_default : input.is_default ? 1 : 0,
      id
    ]);
    return serializeModel(db.get('SELECT * FROM ai_models WHERE id = ?', [id]));
  }

  // --------------------------------------------------------------------------
  // Capability-check real (probes) — confirma chat, json, tool calling e embeddings
  // --------------------------------------------------------------------------
  async function capabilityCheck(modelDbId) {
    const modelo = db.get('SELECT * FROM ai_models WHERE id = ?', [modelDbId]);
    if (!modelo) throw notFound('Modelo de IA não encontrado.', 'MODELO_IA_NAO_ENCONTRADO');
    const { row, apiKey } = carregarConexaoComSegredo(modelo.connection_id);
    if (!row.is_active) {
      throw conflict('Ative a conexão antes de checar capacidades.', 'CONEXAO_INATIVA');
    }
    const adapter = getAdapter(row.provider_type);
    const connection = { ...row, apiKey };
    const capacidades = { ...emptyCapabilities(), ...safeParse(modelo.capabilities) };

    // Probe de chat (também confirma streaming como suportado quando o chat funciona).
    const chatOk = await probeChat(adapter, connection, modelo.model_id, {});
    capacidades.chat = chatOk;
    if (chatOk) capacidades.streaming = true;

    // Probe de JSON estruturado.
    capacidades.json = chatOk
      ? await probeChat(adapter, connection, modelo.model_id, {
          responseFormat: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Responda em JSON válido.' },
            { role: 'user', content: 'Retorne {"ok":true}.' }
          ]
        })
      : false;

    // Probe de tool calling.
    capacidades.tool_calling = chatOk
      ? await probeToolCalling(adapter, connection, modelo.model_id)
      : false;

    // Probe de embeddings.
    capacidades.embeddings = await probeEmbeddings(adapter, connection, modelo.model_id);

    db.run('UPDATE ai_models SET capabilities = ? WHERE id = ?', [
      JSON.stringify(capacidades),
      modelDbId
    ]);
    return serializeModel(db.get('SELECT * FROM ai_models WHERE id = ?', [modelDbId]));
  }

  async function probeChat(adapter, connection, model, { messages, responseFormat } = {}) {
    try {
      const { url, init } = adapter.buildChatRequest(connection, {
        model,
        messages: messages || [{ role: 'user', content: 'Diga: ok' }],
        responseFormat,
        stream: false
      });
      const resposta = await executarHttp({
        url,
        init,
        connectionId: connection.id,
        maxRetries: 0
      });
      const payload = await lerJson(resposta);
      return typeof adapter.extractChatText(payload) === 'string';
    } catch {
      return false;
    }
  }

  async function probeToolCalling(adapter, connection, model) {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'kairo_ping',
          description: 'Retorna pong para checar tool calling.',
          parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
      }
    ];
    try {
      const { url, init } = adapter.buildChatRequest(connection, {
        model,
        messages: [{ role: 'user', content: 'Chame a função kairo_ping.' }],
        tools,
        stream: false
      });
      const resposta = await executarHttp({
        url,
        init,
        connectionId: connection.id,
        maxRetries: 0
      });
      const payload = await lerJson(resposta);
      // Confirmado se o modelo aceitou tools E retornou uma chamada de ferramenta.
      return adapter.hasToolCalls(payload);
    } catch {
      return false;
    }
  }

  async function probeEmbeddings(adapter, connection, model) {
    const request = adapter.buildEmbeddingsRequest?.(connection, { model, input: 'kairo' });
    if (!request) return false;
    try {
      const resposta = await executarHttp({
        url: request.url,
        init: request.init,
        connectionId: connection.id,
        maxRetries: 0
      });
      const payload = await lerJson(resposta);
      const vetor = payload?.data?.[0]?.embedding ?? payload?.embedding ?? payload?.embeddings?.[0];
      return Array.isArray(vetor) && vetor.length > 0;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Roteamento por capacidade (não por nome) — só conexões ATIVAS
  // --------------------------------------------------------------------------
  function resolveForCapability(capabilityKey) {
    if (!CAPABILITY_KEYS.includes(capabilityKey)) {
      throw unprocessable('Capacidade desconhecida.', 'CAPACIDADE_INVALIDA');
    }
    const linhas = db.all(`
      SELECT m.*, c.provider_type, c.base_url, c.is_local, c.is_active
      FROM ai_models m
      INNER JOIN ai_connections c ON c.id = m.connection_id
      WHERE c.is_active = 1
      ORDER BY m.is_default DESC, m.id ASC
    `);
    for (const linha of linhas) {
      const caps = safeParse(linha.capabilities);
      if (caps[capabilityKey] === true) {
        return serializeModel(linha);
      }
    }
    return null;
  }

  // Ações destrutivas exigem tool calling confirmado (nunca presumido).
  function assertToolCapable(modelDbId) {
    const modelo = db.get('SELECT * FROM ai_models WHERE id = ?', [modelDbId]);
    if (!modelo) throw notFound('Modelo de IA não encontrado.', 'MODELO_IA_NAO_ENCONTRADO');
    const caps = safeParse(modelo.capabilities);
    if (caps.tool_calling !== true) {
      throw conflict(
        'Este modelo não confirmou suporte a tool calling e não pode executar ações.',
        'SEM_TOOL_CALLING'
      );
    }
    return serializeModel(modelo);
  }

  return {
    ensureSchema: () => ensureAiSchema(db),
    // CRUD de conexões
    createConnection,
    updateConnection,
    deleteConnection,
    listConnections,
    getConnection,
    // Operações reais
    testConnection,
    discoverModels,
    listModels,
    updateModel,
    capabilityCheck,
    // Roteamento e segurança de uso
    resolveForCapability,
    assertToolCapable
  };
}

function safeParse(json) {
  try {
    return JSON.parse(json || '{}');
  } catch {
    return {};
  }
}

export class AiRequestError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'AiRequestError';
    this.code = code;
    this.meta = meta;
  }
}
