// ============================================================================
// Kairo — Adaptadores reais de provedores de IA (Tarefa 15)
// ----------------------------------------------------------------------------
// Cada adaptador conhece o contrato HTTP real do seu provedor. Nunca detectamos
// o provedor pela URL: o `provider_type` é explícito e persistido. Os adaptadores
// só declaram capacidade quando o servidor/modelo realmente a confirma.
// ============================================================================

/**
 * Tipos de provedor suportados de forma explícita (persistidos em coluna).
 * `openai-compatible` cobre OpenAI, OpenRouter, Groq, Together e afins.
 */
export const PROVIDER_TYPES = Object.freeze([
  'openai-compatible',
  'anthropic',
  'ollama',
  'lmstudio'
]);

export const LOCAL_PROVIDER_TYPES = Object.freeze(['ollama', 'lmstudio']);

// Hosts padrão sugeridos para provedores locais (apenas sugestão de UI).
export const DEFAULT_LOCAL_HOSTS = Object.freeze({
  ollama: 'http://127.0.0.1:11434',
  lmstudio: 'http://192.168.0.7:1234'
});

// Capacidades rastreadas por modelo. `null` = desconhecida (ainda não confirmada).
export const CAPABILITY_KEYS = Object.freeze([
  'chat',
  'streaming',
  'json',
  'embeddings',
  'vision',
  'tool_calling'
]);

// Versão fixada da API da Anthropic (adaptador nativo, não OpenAI).
const ANTHROPIC_VERSION = '2023-06-01';

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

// Remove sufixos comuns para compor caminhos de forma previsível.
function stripOpenAiSuffix(baseUrl) {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/, '');
}

function authHeaders(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

// ----------------------------------------------------------------------------
// Adaptador OpenAI-compatível (OpenAI, OpenRouter, Groq, Together AI, LM Studio)
// ----------------------------------------------------------------------------
const openAiCompatible = Object.freeze({
  type: 'openai-compatible',
  isLocalByDefault: false,

  // Base já deve conter o sufixo /v1 quando o provedor exigir; normalizamos.
  resolveBase(baseUrl) {
    const base = normalizeBaseUrl(baseUrl);
    return /\/v1$/.test(base) ? base : `${base}/v1`;
  },

  buildListModelsRequest(connection) {
    return {
      url: `${this.resolveBase(connection.base_url)}/models`,
      init: {
        method: 'GET',
        headers: { Accept: 'application/json', ...authHeaders(connection.apiKey) }
      }
    };
  },

  parseModels(payload) {
    const lista = Array.isArray(payload?.data) ? payload.data : [];
    return lista
      .map((item) => ({
        model_id: String(item.id ?? item.model ?? '').trim(),
        display_name: String(item.id ?? item.model ?? '').trim(),
        max_context: Number(item.context_length ?? item.context_window ?? 0) || null,
        loaded: item.state ? item.state === 'loaded' : null
      }))
      .filter((model) => model.model_id.length > 0);
  },

  buildChatRequest(connection, { model, messages, tools, responseFormat, stream }) {
    const body = { model, messages };
    if (tools) body.tools = tools;
    if (responseFormat) body.response_format = responseFormat;
    if (stream) body.stream = true;
    return {
      url: `${this.resolveBase(connection.base_url)}/chat/completions`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...authHeaders(connection.apiKey)
        },
        body: JSON.stringify(body)
      }
    };
  },

  buildEmbeddingsRequest(connection, { model, input }) {
    return {
      url: `${this.resolveBase(connection.base_url)}/embeddings`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...authHeaders(connection.apiKey)
        },
        body: JSON.stringify({ model, input })
      }
    };
  },

  extractChatText(payload) {
    return payload?.choices?.[0]?.message?.content ?? null;
  },

  hasToolCalls(payload) {
    return Array.isArray(payload?.choices?.[0]?.message?.tool_calls);
  }
});

// LM Studio: OpenAI-compatível em /v1, com REST nativa /api/v0 para estado real.
const lmStudio = Object.freeze({
  ...openAiCompatible,
  type: 'lmstudio',
  isLocalByDefault: true,

  // Preferimos a REST nativa /api/v0/models, que informa estado carregado e tipo.
  buildListModelsRequest(connection) {
    return {
      url: `${stripOpenAiSuffix(connection.base_url)}/api/v0/models`,
      init: {
        method: 'GET',
        headers: { Accept: 'application/json', ...authHeaders(connection.apiKey) }
      }
    };
  },

  parseModels(payload) {
    const lista = Array.isArray(payload?.data) ? payload.data : [];
    return lista
      .map((item) => ({
        model_id: String(item.id ?? '').trim(),
        display_name: String(item.id ?? '').trim(),
        max_context: Number(item.max_context_length ?? item.loaded_context_length ?? 0) || null,
        loaded: item.state ? item.state === 'loaded' : null,
        // LM Studio declara capacidades reais de visão em `type`/`vision`.
        declared_vision: item.type === 'vlm' || item.vision === true
      }))
      .filter((model) => model.model_id.length > 0);
  }
});

// ----------------------------------------------------------------------------
// Adaptador Ollama (REST nativa + compatibilidade OpenAI opcional)
// ----------------------------------------------------------------------------
const ollama = Object.freeze({
  type: 'ollama',
  isLocalByDefault: true,

  buildListModelsRequest(connection) {
    return {
      url: `${normalizeBaseUrl(connection.base_url)}/api/tags`,
      init: {
        method: 'GET',
        headers: { Accept: 'application/json', ...authHeaders(connection.apiKey) }
      }
    };
  },

  parseModels(payload) {
    const lista = Array.isArray(payload?.models) ? payload.models : [];
    return lista
      .map((item) => ({
        model_id: String(item.model ?? item.name ?? '').trim(),
        display_name: String(item.name ?? item.model ?? '').trim(),
        max_context: null,
        loaded: null,
        declared_families: Array.isArray(item.details?.families) ? item.details.families : []
      }))
      .filter((model) => model.model_id.length > 0);
  },

  // Chat nativo /api/chat (stream=false por padrão para respostas unitárias).
  buildChatRequest(connection, { model, messages, tools, responseFormat, stream }) {
    const body = { model, messages, stream: Boolean(stream) };
    if (tools) body.tools = tools;
    if (responseFormat?.type === 'json_object') body.format = 'json';
    return {
      url: `${normalizeBaseUrl(connection.base_url)}/api/chat`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...authHeaders(connection.apiKey)
        },
        body: JSON.stringify(body)
      }
    };
  },

  buildEmbeddingsRequest(connection, { model, input }) {
    return {
      url: `${normalizeBaseUrl(connection.base_url)}/api/embed`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...authHeaders(connection.apiKey)
        },
        body: JSON.stringify({ model, input })
      }
    };
  },

  extractChatText(payload) {
    return payload?.message?.content ?? null;
  },

  hasToolCalls(payload) {
    return Array.isArray(payload?.message?.tool_calls);
  }
});

// ----------------------------------------------------------------------------
// Adaptador Anthropic (nativo — NÃO presume compatibilidade OpenAI)
// ----------------------------------------------------------------------------
const anthropic = Object.freeze({
  type: 'anthropic',
  isLocalByDefault: false,

  resolveBase(baseUrl) {
    const base = normalizeBaseUrl(baseUrl) || 'https://api.anthropic.com';
    return /\/v1$/.test(base) ? base : `${base}/v1`;
  },

  anthropicHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      ...(apiKey ? { 'x-api-key': apiKey } : {})
    };
  },

  buildListModelsRequest(connection) {
    return {
      url: `${this.resolveBase(connection.base_url)}/models`,
      init: { method: 'GET', headers: this.anthropicHeaders(connection.apiKey) }
    };
  },

  parseModels(payload) {
    const lista = Array.isArray(payload?.data) ? payload.data : [];
    return lista
      .map((item) => ({
        model_id: String(item.id ?? '').trim(),
        display_name: String(item.display_name ?? item.id ?? '').trim(),
        max_context: null,
        loaded: null
      }))
      .filter((model) => model.model_id.length > 0);
  },

  // Anthropic Messages API: system fora do array; max_tokens obrigatório.
  buildChatRequest(connection, { model, messages, tools, stream }) {
    const system = messages.find((m) => m.role === 'system')?.content;
    const conversa = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const body = { model, max_tokens: 256, messages: conversa };
    if (system) body.system = system;
    if (tools) body.tools = tools;
    if (stream) body.stream = true;
    return {
      url: `${this.resolveBase(connection.base_url)}/messages`,
      init: {
        method: 'POST',
        headers: this.anthropicHeaders(connection.apiKey),
        body: JSON.stringify(body)
      }
    };
  },

  // Anthropic não expõe embeddings próprias; sinalizamos ausência real.
  buildEmbeddingsRequest() {
    return null;
  },

  extractChatText(payload) {
    const bloco = Array.isArray(payload?.content)
      ? payload.content.find((part) => part.type === 'text')
      : null;
    return bloco?.text ?? null;
  },

  hasToolCalls(payload) {
    return (
      Array.isArray(payload?.content) && payload.content.some((part) => part.type === 'tool_use')
    );
  }
});

const ADAPTERS = Object.freeze({
  'openai-compatible': openAiCompatible,
  lmstudio: lmStudio,
  ollama,
  anthropic
});

export function getAdapter(providerType) {
  const adapter = ADAPTERS[providerType];
  if (!adapter) {
    throw new Error(`Tipo de provedor de IA não suportado: ${providerType}`);
  }
  return adapter;
}
