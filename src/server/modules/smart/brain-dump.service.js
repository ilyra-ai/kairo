// ============================================================================
// Kairo — Brain Dump → Plano Instantâneo (Tarefa 35.5)
// ----------------------------------------------------------------------------
// Transforma um despejo livre de ideias em uma lista de tarefas acionáveis com
// estimativa (parser/heurística determinística). NÃO persiste nada no parse:
// o usuário revê, escolhe e confirma; só então `commit` cria os registros reais.
// A IA é opcional (decompõe e estima melhor em outra camada).
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

const FEATURE_KEY = 'brain_dump';

// Verbos de ação comuns em pt-BR — presença sugere tarefa "acionável".
const VERBOS_ACAO =
  /^(fazer|criar|escrever|enviar|ligar|comprar|estudar|ler|revisar|preparar|organizar|agendar|marcar|terminar|finalizar|planejar|pesquisar|responder|pagar|limpar|treinar|montar|corrigir|atualizar|entregar)\b/i;

export function createBrainDumpService({ db, smartFeaturesService, activitiesService } = {}) {
  if (!db || !smartFeaturesService || !activitiesService) {
    throw new Error('O Brain Dump exige banco de dados, governança inteligente e atividades.');
  }

  // Quebra o texto livre em candidatos a tarefa: por linha e por separadores
  // comuns (vírgula, ponto e vírgula, marcadores).
  function extrairItens(texto) {
    const bruto = String(texto || '');
    const linhas = bruto
      .split(/\r?\n/)
      .flatMap((linha) => linha.split(/;|(?:,\s)|(?:\s-\s)/))
      .map((s) => s.replace(/^[\s*\-•\d.)]+/, '').trim())
      .filter((s) => s.length >= 2);
    // Remove duplicatas preservando ordem.
    const vistos = new Set();
    const itens = [];
    for (const linha of linhas) {
      const chave = linha.toLowerCase();
      if (!vistos.has(chave)) {
        vistos.add(chave);
        itens.push(linha);
      }
    }
    return itens;
  }

  // Estimativa heurística de duração (minutos): base configurável + ajuste por
  // tamanho e por indícios de complexidade.
  function estimar(item, base) {
    let minutos = base;
    const palavras = item.split(/\s+/).length;
    if (palavras > 8) minutos += base; // itens longos tendem a durar mais
    if (/relat[óo]rio|projeto|apresenta|planej|estrat/i.test(item)) minutos += base;
    return minutos;
  }

  function parse(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const texto = String(input.text || '').trim();
    if (texto.length < 2) throw unprocessable('Escreva algo para organizar.', 'TEXTO_VAZIO');
    const params = smartFeaturesService.params(FEATURE_KEY);
    const limite = Number(params.limite_itens) || 30;
    const base = Number(params.estimativa_padrao_min) || 25;

    const itens = extrairItens(texto)
      .slice(0, limite)
      .map((item) => ({
        title: item.charAt(0).toUpperCase() + item.slice(1),
        estimate_min: estimar(item, base),
        actionable: VERBOS_ACAO.test(item)
      }));

    return { count: itens.length, items: itens };
  }

  // Cria os itens confirmados como atividades reais (nada é criado sem escolha).
  function commit(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const itens = Array.isArray(input.items) ? input.items : [];
    if (itens.length === 0) throw unprocessable('Selecione ao menos um item.', 'SEM_ITENS');

    const criados = [];
    for (const item of itens) {
      const titulo = String(item.title || '').trim();
      if (titulo.length < 1) continue;
      try {
        criados.push(activitiesService.create(userId, { title: titulo }));
      } catch (error) {
        // Duplicatas são ignoradas com transparência (não interrompem o lote).
        if (error?.code !== 'ATIVIDADE_DUPLICADA') throw error;
      }
    }
    return { created: criados.length, activities: criados };
  }

  return { parse, commit };
}
