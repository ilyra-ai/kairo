// ============================================================================
// Kairo — Assistente de IA com chat e ações reais (Tarefa 16)
// ----------------------------------------------------------------------------
// O assistente conversa com o MODELO ATIVO do usuário (via gateway), montando o
// contexto a partir das competências publicadas (Estúdio de Treinamento) e da
// memória do próprio usuário (quando habilitada, como DADOS, nunca instrução).
// As AÇÕES são executadas por tool calling REAL sobre os serviços do próprio
// usuário, com POLÍTICA DE CONFIRMAÇÃO: leitura executa direto; criação/edição/
// exclusão exigem confirmação explícita (a resposta devolve uma proposta e só
// executa quando o cliente confirma). Toda ferramenta revalida proprietário,
// schema e permissão no servidor; o sucesso só é afirmado após o banco confirmar.
// ============================================================================

import { conflict, unprocessable } from '../../shared/http-error.js';

// Classificação de risco por ferramenta (alinhada à governança de ferramentas).
const RISCO = Object.freeze({ LEITURA: 'leitura', ESCRITA: 'escrita', DESTRUTIVA: 'destrutiva' });

export function createAiAssistantService({
  db,
  aiService,
  aiTrainingService,
  aiMemoryService,
  aiGovernanceService,
  activitiesService,
  agendaService,
  now = () => new Date()
} = {}) {
  if (!db || !aiService) {
    throw new Error('O assistente exige banco de dados e o gateway de IA.');
  }

  // --------------------------------------------------------------------------
  // Catálogo de ferramentas reais do assistente (sobre dados do PRÓPRIO usuário)
  // --------------------------------------------------------------------------
  const FERRAMENTAS = Object.freeze({
    listar_atividades: {
      risco: RISCO.LEITURA,
      descricao: 'Lista as atividades/categorias do usuário.',
      parametros: { type: 'object', properties: {}, additionalProperties: false },
      executar: (userId) => activitiesService.list(userId)
    },
    consultar_agenda: {
      risco: RISCO.LEITURA,
      descricao: 'Consulta os compromissos da agenda do usuário.',
      parametros: {
        type: 'object',
        properties: { activity_id: { type: 'integer' } },
        additionalProperties: false
      },
      executar: (userId, args) =>
        agendaService.list(userId, args?.activity_id ? { activity_id: args.activity_id } : {})
    },
    criar_atividade: {
      risco: RISCO.ESCRITA,
      descricao: 'Cria uma nova atividade/categoria.',
      parametros: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false
      },
      executar: (userId, args) => {
        if (!args?.title || String(args.title).trim().length < 1) {
          throw unprocessable('Título da atividade é obrigatório.', 'TITULO_OBRIGATORIO');
        }
        return activitiesService.create(userId, { title: String(args.title).trim() });
      }
    },
    criar_compromisso: {
      risco: RISCO.ESCRITA,
      descricao:
        'Agenda um compromisso vinculado a uma atividade. Exige data (YYYY-MM-DD) e horários.',
      parametros: {
        type: 'object',
        properties: {
          activity_id: { type: 'integer' },
          title: { type: 'string' },
          event_date: { type: 'string' },
          start_time: { type: 'string' },
          end_time: { type: 'string' }
        },
        required: ['activity_id', 'title', 'event_date', 'start_time', 'end_time'],
        additionalProperties: false
      },
      executar: (userId, args) =>
        agendaService.create(userId, {
          activity_id: args.activity_id,
          title: String(args.title || '').trim(),
          event_date: args.event_date,
          start_time: args.start_time,
          end_time: args.end_time
        })
    },
    excluir_atividade: {
      risco: RISCO.DESTRUTIVA,
      descricao: 'Exclui uma atividade/categoria e seus dados.',
      parametros: {
        type: 'object',
        properties: { activity_id: { type: 'integer' } },
        required: ['activity_id'],
        additionalProperties: false
      },
      executar: (userId, args) => activitiesService.remove(userId, args.activity_id)
    }
  });

  function ferramentasParaModelo() {
    return Object.entries(FERRAMENTAS).map(([nome, def]) => ({
      type: 'function',
      function: { name: nome, description: def.descricao, parameters: def.parametros }
    }));
  }

  // --------------------------------------------------------------------------
  // Montagem do contexto (competências publicadas + memória como DADOS)
  // --------------------------------------------------------------------------
  function montarSystemPrompt(userId) {
    const partes = [];
    if (aiTrainingService) {
      const contexto = aiTrainingService.activeContext();
      if (contexto.length) {
        partes.push(contexto.map((c) => `# ${c.name}\n${c.content}`).join('\n\n'));
      }
    }
    if (aiMemoryService && aiMemoryService.isEnabled(userId)) {
      const bloco = aiMemoryService.buildContextBlock(userId, { purpose: 'assistente', budget: 8 });
      if (bloco) partes.push(bloco);
    }
    partes.push(
      'Você é o assistente do Kairo. Aja apenas sobre os dados do próprio usuário. Para ações de ' +
        'criação, edição ou exclusão, proponha e aguarde confirmação. Responda em pt-BR, com honestidade: ' +
        'só afirme que executou algo após a confirmação real da ferramenta.'
    );
    return partes.join('\n\n');
  }

  // Resolve a conexão/modelo ativos (padrão: modelo com capacidade de chat).
  function resolverModelo({ connectionId = null, model = null } = {}) {
    if (connectionId && model) return { connectionId, model };
    const alvo = aiService.resolveForCapability('chat');
    if (!alvo) {
      throw conflict(
        'Nenhum modelo de IA com capacidade de chat está configurado e ativo.',
        'SEM_MODELO_CHAT'
      );
    }
    return { connectionId: alvo.connection_id, model: alvo.model_id, modelDbId: alvo.id };
  }

  function registrarTelemetria(userId, resultado, purpose) {
    if (!aiGovernanceService) return;
    aiGovernanceService.recordExecution({
      user_id: userId,
      provider: resultado.provider,
      model: null, // não guardamos nome sensível de deployment além do provedor
      purpose,
      duration_ms: resultado.duration_ms,
      input_tokens: resultado.usage?.prompt_tokens ?? null,
      output_tokens: resultado.usage?.completion_tokens ?? null,
      tool_calls: Array.isArray(resultado.tool_calls) ? resultado.tool_calls.length : 0,
      status: 'sucesso'
    });
  }

  // --------------------------------------------------------------------------
  // Chat com ações: leitura executa direto; escrita/destrutiva exige confirmação
  // --------------------------------------------------------------------------
  async function chat(userId, input = {}) {
    const mensagens = Array.isArray(input.messages) ? input.messages : [];
    if (mensagens.length === 0) {
      throw unprocessable('Envie ao menos uma mensagem.', 'MENSAGENS_VAZIAS');
    }
    // Se o cliente confirmou uma ação proposta, executa-a agora (sem novo LLM).
    if (input.confirm && input.confirm.tool) {
      return executarAcaoConfirmada(userId, input.confirm);
    }

    const { connectionId, model } = resolverModelo(input);
    const system = montarSystemPrompt(userId);
    const payloadMensagens = [{ role: 'system', content: system }, ...mensagens];

    const resultado = await aiService.runChat({
      connectionId,
      model,
      messages: payloadMensagens,
      tools: ferramentasParaModelo()
    });
    registrarTelemetria(userId, resultado, 'assistente');

    const propostas = [];
    const execucoes = [];
    for (const chamada of resultado.tool_calls) {
      const def = FERRAMENTAS[chamada.name];
      if (!def) continue;
      if (def.risco === RISCO.LEITURA) {
        // Leitura pode executar diretamente dentro da autorização.
        const dados = def.executar(userId, chamada.arguments);
        execucoes.push({ tool: chamada.name, result: dados });
      } else {
        // Criação/edição/exclusão: propor e aguardar confirmação explícita.
        propostas.push({
          tool: chamada.name,
          risk: def.risco,
          arguments: chamada.arguments,
          confirmation_required: true,
          summary: descreverProposta(chamada.name, chamada.arguments)
        });
      }
    }

    return {
      message: resultado.text,
      provider: resultado.provider,
      is_local: resultado.is_local,
      executions: execucoes,
      proposals: propostas
    };
  }

  function descreverProposta(tool, args) {
    switch (tool) {
      case 'criar_atividade':
        return `Criar a atividade "${args.title}".`;
      case 'criar_compromisso':
        return `Agendar "${args.title}" em ${args.event_date} das ${args.start_time} às ${args.end_time}.`;
      case 'excluir_atividade':
        return `Excluir a atividade #${args.activity_id} e seus dados.`;
      default:
        return `Executar a ação ${tool}.`;
    }
  }

  // Executa a ação previamente proposta, após confirmação explícita do usuário.
  function executarAcaoConfirmada(userId, confirm) {
    const def = FERRAMENTAS[confirm.tool];
    if (!def) throw unprocessable('Ação desconhecida.', 'ACAO_DESCONHECIDA');
    if (def.risco === RISCO.LEITURA) {
      throw unprocessable('Esta ação não requer confirmação.', 'CONFIRMACAO_DESNECESSARIA');
    }
    const resultado = def.executar(userId, confirm.arguments || {});
    return {
      message: `Ação "${confirm.tool}" executada com sucesso.`,
      executions: [{ tool: confirm.tool, result: resultado ?? { done: true } }],
      proposals: []
    };
  }

  // --------------------------------------------------------------------------
  // Copiloto de escrita (nove assistências) — NÃO altera o formulário sem aceite
  // --------------------------------------------------------------------------
  const ASSISTENCIAS = Object.freeze({
    correcao:
      'Corrija ortografia e gramática do texto a seguir sem mudar a intenção. Devolva só o texto corrigido.',
    clareza:
      'Reescreva o texto a seguir com mais clareza, contexto e resultado esperado, preservando a intenção.',
    passos: 'Liste passos objetivos para executar a tarefa descrita a seguir de forma mais rápida.',
    microtarefas:
      'Decomponha a tarefa a seguir em microtarefas acionáveis, curtas e sem ambiguidade.',
    estimativa:
      'Estime a duração da tarefa a seguir em uma faixa (mín–máx) com nível de confiança, sem falsa precisão.',
    dependencias:
      'Identifique dependências, conflitos e um plano alternativo para a tarefa a seguir.',
    prioridade:
      'Sugira prioridade, carga cognitiva e melhor período para a tarefa a seguir, com justificativa breve.',
    criterio: 'Transforme a tarefa a seguir em um critério de conclusão verificável e observável.'
  });

  async function copilot(userId, input = {}) {
    const kind = input.kind;
    const texto = String(input.text || '').trim();
    if (!ASSISTENCIAS[kind]) {
      throw unprocessable('Tipo de assistência inválido.', 'ASSISTENCIA_INVALIDA');
    }
    if (texto.length < 2) {
      throw unprocessable('Escreva um texto para o copiloto ajudar.', 'TEXTO_VAZIO');
    }
    const { connectionId, model } = resolverModelo(input);
    const resultado = await aiService.runChat({
      connectionId,
      model,
      messages: [
        {
          role: 'system',
          content:
            'Você é um copiloto de escrita do Kairo. Responda em pt-BR, apenas com a sugestão pedida.'
        },
        { role: 'user', content: `${ASSISTENCIAS[kind]}\n\nTexto:\n${texto}` }
      ]
    });
    registrarTelemetria(userId, resultado, 'copiloto');
    return {
      kind,
      original: texto,
      suggestion: resultado.text,
      applied: false, // nunca aplica automaticamente
      provider: resultado.provider,
      is_local: resultado.is_local
    };
  }

  function tools() {
    return Object.entries(FERRAMENTAS).map(([nome, def]) => ({ name: nome, risk: def.risco }));
  }

  return { chat, copilot, tools, _now: now };
}
