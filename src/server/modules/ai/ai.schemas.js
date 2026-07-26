// ============================================================================
// Kairo — Contratos de validação do gateway de IA (Tarefa 15)
// ============================================================================

import { z } from 'zod';
import { PROVIDER_TYPES } from './ai.adapters.js';
import {
  ARTIFACT_SCOPES,
  ARTIFACT_TYPES,
  MCP_AUTH_TYPES,
  MCP_TRANSPORTS,
  TOOL_RISK_CLASSES
} from './ai-training.service.js';

const nome = z.string().trim().min(2, 'Informe um nome para a conexão.').max(120);
const baseUrl = z
  .string()
  .trim()
  .min(1, 'Informe a URL base.')
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), 'A URL deve começar com http:// ou https://');

export const createAiConnectionSchema = z
  .object({
    name: nome,
    provider_type: z.enum(PROVIDER_TYPES),
    base_url: baseUrl,
    api_key: z.string().min(1).max(4096).optional(),
    is_local: z.boolean().optional(),
    allow_remote_host: z.boolean().optional()
  })
  .strict();

export const updateAiConnectionSchema = z
  .object({
    name: nome.optional(),
    provider_type: z.enum(PROVIDER_TYPES).optional(),
    base_url: baseUrl.optional(),
    // string preenchida substitui; null remove; ausência mantém.
    api_key: z.union([z.string().min(1).max(4096), z.null()]).optional(),
    is_local: z.boolean().optional(),
    is_active: z.boolean().optional(),
    allow_remote_host: z.boolean().optional()
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo para atualizar.');

export const aiConnectionIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

export const aiModelIdParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

export const updateAiModelSchema = z
  .object({
    display_name: z.string().trim().min(1).max(160).optional(),
    is_default: z.boolean().optional()
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo para atualizar.');

export const listModelsQuerySchema = z
  .object({ connection_id: z.coerce.number().int().positive().optional() })
  .strict();

// ---------------------------------------------------------------------------
// Estúdio de Treinamento (Tarefa 27)
// ---------------------------------------------------------------------------
const artefatoNome = z.string().trim().min(2).max(160);

export const createTrainingArtifactSchema = z
  .object({
    name: artefatoNome,
    type: z.enum(ARTIFACT_TYPES),
    description: z.string().trim().max(1000).optional(),
    content: z.string().max(8000).optional(),
    scope: z.enum(ARTIFACT_SCOPES).optional(),
    scope_ref: z.string().trim().max(160).nullable().optional(),
    priority: z.coerce.number().int().min(0).max(9999).optional(),
    allowed_tools: z.array(z.string().trim().max(120)).max(100).optional(),
    allowed_data: z.array(z.string().trim().max(120)).max(100).optional(),
    changelog: z.string().trim().max(1000).optional()
  })
  .strict();

export const updateTrainingArtifactSchema = z
  .object({
    name: artefatoNome.optional(),
    type: z.enum(ARTIFACT_TYPES).optional(),
    description: z.string().trim().max(1000).optional(),
    content: z.string().max(8000).optional(),
    scope: z.enum(ARTIFACT_SCOPES).optional(),
    scope_ref: z.string().trim().max(160).nullable().optional(),
    priority: z.coerce.number().int().min(0).max(9999).optional(),
    allowed_tools: z.array(z.string().trim().max(120)).max(100).optional(),
    allowed_data: z.array(z.string().trim().max(120)).max(100).optional(),
    changelog: z.string().trim().max(1000).optional()
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo para atualizar.');

export const trainingArtifactIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

export const listTrainingQuerySchema = z
  .object({
    type: z.enum(ARTIFACT_TYPES).optional(),
    state: z.enum(['rascunho', 'em_teste', 'publicado', 'arquivado']).optional()
  })
  .strict();

export const upsertToolPolicySchema = z
  .object({
    tool_name: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9_.-]+$/i, 'Nome de ferramenta inválido.'),
    description: z.string().trim().max(500).optional(),
    allowed: z.boolean().optional(),
    requires_confirmation: z.boolean().optional(),
    destructive: z.boolean().optional(),
    risk_class: z.enum(TOOL_RISK_CLASSES).optional(),
    read_scopes: z.array(z.string().trim().min(2).max(120)).max(100).optional(),
    write_scopes: z.array(z.string().trim().min(2).max(120)).max(100).optional(),
    max_calls: z.coerce.number().int().min(1).max(10000).optional(),
    window_seconds: z.coerce.number().int().min(1).max(86400).optional(),
    source_type: z.enum(['interno', 'mcp']).optional(),
    mcp_server_id: z.coerce.number().int().positive().nullable().optional()
  })
  .strict();

const versionNumber = z.coerce.number().int().positive();
const rationale = z
  .string()
  .trim()
  .min(10, 'Informe uma justificativa com ao menos 10 caracteres.')
  .max(1000);

export const compareTrainingVersionsQuerySchema = z
  .object({ left: versionNumber, right: versionNumber })
  .strict()
  .refine((input) => input.left !== input.right, 'Selecione duas versões diferentes.');

export const evaluateTrainingArtifactSchema = z
  .object({
    version: versionNumber.optional(),
    model_id: z.coerce.number().int().positive().optional()
  })
  .strict();

export const updateEvaluationSettingsSchema = z
  .object({ regression_threshold: z.coerce.number().min(0).max(50) })
  .strict();

export const approveTrainingVersionSchema = z
  .object({ version: versionNumber, rationale })
  .strict();

export const rollbackTrainingVersionSchema = z
  .object({ version: versionNumber.optional(), reason: rationale.optional() })
  .strict();

export const startCanarySchema = z
  .object({
    version: versionNumber.optional(),
    traffic_percent: z.coerce.number().int().min(1).max(100),
    min_samples: z.coerce.number().int().min(1).max(100000),
    max_error_rate: z.coerce.number().min(0).max(100)
  })
  .strict();

export const canaryIdParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

export const finishCanarySchema = z
  .object({ action: z.enum(['promote', 'abort']), reason: rationale })
  .strict();

export const toolNameParamsSchema = z
  .object({
    tool_name: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9_.-]+$/i)
  })
  .strict();

export const governanceDecisionSchema = z
  .object({ action: z.enum(['approve', 'revoke']), rationale })
  .strict();

const mcpUrl = z
  .string()
  .url('Informe uma URL MCP válida.')
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
    );
  }, 'MCP remoto exige HTTPS; HTTP é aceito somente no host local.');

const mcpServerFields = {
  name: z.string().trim().min(2).max(120),
  server_url: mcpUrl,
  transport: z.enum(MCP_TRANSPORTS),
  auth_type: z.enum(MCP_AUTH_TYPES),
  oauth_issuer: z.string().url().max(2048).nullable().optional(),
  oauth_client_id: z.string().trim().min(2).max(500).nullable().optional(),
  requested_scopes: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
  credential_reference: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .regex(
      /^(vault|secret-manager|key-vault):\/\//i,
      'Use uma referência de cofre externo, nunca um token literal.'
    )
    .nullable()
    .optional(),
  allowlisted: z.boolean().optional(),
  tools_reviewed: z.boolean().optional()
};

export const createMcpServerSchema = z.object(mcpServerFields).strict();
export const updateMcpServerSchema = z
  .object(
    Object.fromEntries(
      Object.entries(mcpServerFields).map(([key, schema]) => [key, schema.optional()])
    )
  )
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'Informe ao menos um campo.');

export const mcpServerIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

// ---------------------------------------------------------------------------
// Memória de IA (Tarefa 28)
// ---------------------------------------------------------------------------
const MEMORY_TYPE_KEYS = [
  'preferencia',
  'fato',
  'resumo_contexto',
  'padrao_operacional',
  'episodica',
  'semantica'
];
const MEMORY_PURPOSE_KEYS = ['personalizacao', 'planejamento', 'contexto_sessao', 'assistente'];

export const rememberMemorySchema = z
  .object({
    type: z.enum(MEMORY_TYPE_KEYS),
    purpose: z.enum(MEMORY_PURPOSE_KEYS),
    content: z.string().trim().min(2).max(4000),
    confidence: z.coerce.number().min(0).max(1).optional(),
    source: z.string().trim().max(80).optional()
  })
  .strict();

export const memoryItemIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

export const memoryUserIdParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strict();

export const adminBlockWritesSchema = z.object({ blocked: z.boolean() }).strict();

// ---------------------------------------------------------------------------
// Assistente de IA (Tarefa 16)
// ---------------------------------------------------------------------------
export const assistantChatSchema = z
  .object({
    message: z.string().trim().min(1).max(4000).optional(),
    remote_consent: z.boolean().optional(),
    confirm: z
      .object({
        proposal_id: z.string().uuid('Identificador de proposta inválido.')
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((input, context) => {
    const hasMessage = Boolean(input.message);
    const hasConfirmation = Boolean(input.confirm);
    if (hasMessage === hasConfirmation) {
      context.addIssue({
        code: 'custom',
        path: ['message'],
        message: 'Envie uma mensagem ou uma confirmação, nunca ambas.'
      });
    }
    if (hasConfirmation && input.remote_consent !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['remote_consent'],
        message: 'A confirmação de proposta não envia texto ao provedor.'
      });
    }
  });

export const assistantCopilotSchema = z
  .object({
    kind: z.enum([
      'correcao',
      'clareza',
      'passos',
      'dicas',
      'microtarefas',
      'estimativa',
      'dependencias',
      'prioridade',
      'criterio'
    ]),
    text: z.string().trim().min(2).max(4000),
    remote_consent: z.boolean().optional()
  })
  .strict();

export const assistantProposalParamsSchema = z
  .object({ proposal_id: z.string().uuid('Identificador de proposta inválido.') })
  .strict();

export const assistantHistoryQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).optional() })
  .strict();

// ---------------------------------------------------------------------------
// Governança de IA 2026 (Tarefa 30) — Model Router
// ---------------------------------------------------------------------------
export const updateRouterPolicySchema = z
  .object({
    sensitive_local_only: z.boolean().optional(),
    tools_require_capability: z.boolean().optional(),
    fallback_allowed: z.boolean().optional(),
    max_latency_ms: z.coerce.number().int().min(0).max(600000).nullable().optional()
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo.');
