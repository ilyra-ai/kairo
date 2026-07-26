// ============================================================================
// Kairo — Suíte de Produtividade Inteligente Administrável (Tarefa 35.0)
// ----------------------------------------------------------------------------
// Governança única dos recursos inteligentes: um registro administrável onde o
// administrador liga/desliga cada recurso, edita parâmetros, vincula um modelo
// de IA (Tarefa 15) e um artefato de treinamento (Tarefa 27), executa um dry-run
// e consulta a auditoria. Cada recurso tem engine determinístico próprio; a IA é
// sempre OPCIONAL. Nenhum recurso é hardcoded no fluxo: o estado vem do banco.
// ============================================================================

import { notFound, unprocessable } from '../../shared/http-error.js';

// Catálogo dos 12 recursos (semeado uma única vez; editável pelo administrador).
export const SMART_FEATURES = Object.freeze([
  {
    key: 'energy_budget',
    name: 'Orçamento de Energia',
    description:
      'Gestão de capacidade: compara a carga cognitiva planejada do dia com um orçamento diário e alerta antes da sobrecarga.',
    category: 'capacidade',
    requires_ai: false,
    default_params: {
      orcamento_base: 12,
      peso_leve: 1,
      peso_media: 2,
      peso_intensa: 3,
      limiar_alerta: 0.9
    }
  },
  {
    key: 'auto_scheduler',
    name: 'Agendador Autônomo (Auto-organizar meu dia)',
    description:
      'Solver determinístico que aloca tarefas em janelas livres respeitando prazo, duração, prioridade, carga cognitiva e picos de energia. Gera prévia; nunca aplica sem confirmação.',
    category: 'planejamento',
    requires_ai: false,
    default_params: {
      inicio_trabalho: '09:00',
      fim_trabalho: '18:00',
      bloco_min: 30,
      folga_min: 10,
      prioriza_energia: true
    }
  },
  {
    key: 'passive_tracking',
    name: 'Rastreamento Passivo Inteligente',
    description:
      'Detecta padrões de uso do próprio app (foco, seções, tempo por layout) e sugere lançar como atividade. Nunca lança sem consentimento.',
    category: 'registro',
    requires_ai: false,
    default_params: {
      granularidade_min: 5,
      retencao_dias: 30,
      coletar_foco: true,
      coletar_secoes: true
    }
  },
  {
    key: 'transition_bridge',
    name: 'Ponte de Transição entre Tarefas',
    description:
      'Micro-ritual guiado entre tarefas (respiração, contagem, som curto) e preparação da próxima. Reduz o custo de transição no TDAH/TEA.',
    category: 'foco',
    requires_ai: false,
    default_params: {
      duracao_seg: 30,
      tipo: 'respiracao',
      som_permitido: true,
      aviso_antecedencia_min: 5
    }
  },
  {
    key: 'brain_dump',
    name: 'Brain Dump → Plano Instantâneo',
    description:
      'Captura um despejo livre de ideias e transforma em tarefas com estimativa, mediante confirmação. Vence a página em branco.',
    category: 'captura',
    requires_ai: false,
    default_params: { limite_itens: 30, estimativa_padrao_min: 25 }
  },
  {
    key: 'persistent_reminders',
    name: 'Lembretes Persistentes Escalonados',
    description:
      'Escalona lembretes até o usuário agir ou adiar conscientemente — um lembrete só costuma ser ignorado.',
    category: 'lembretes',
    requires_ai: false,
    default_params: { intervalos_min: [5, 15, 30], max_escalonamentos: 3 }
  },
  {
    key: 'now_mode',
    name: 'Modo Agora (foco no presente)',
    description:
      'Reduz a interface ao essencial do momento: a tarefa atual e a próxima, sem distração.',
    category: 'foco',
    requires_ai: false,
    default_params: { mostrar_proxima: true, ocultar_sidebar: true }
  },
  {
    key: 'predictive_coach',
    name: 'Coach Preditivo Proativo',
    description:
      'Detecta padrões de risco (sobrecarga, procrastinação, horários improdutivos) e sugere ajustes proativos. Melhor com IA vinculada.',
    category: 'coaching',
    requires_ai: false,
    default_params: { janela_dias: 14, limiar_procrastinacao: 0.5 }
  },
  {
    key: 'focus_time_machine',
    name: 'Máquina do Tempo do Foco',
    description:
      'Simulação preditiva: projeta se as metas serão cumpridas no ritmo atual e o que muda ao ajustar o plano.',
    category: 'simulacao',
    requires_ai: false,
    default_params: { horizonte_dias: 30 }
  },
  {
    key: 'digital_twin',
    name: 'Gêmeo Digital de Produtividade',
    description:
      'Modelo do usuário a partir dos próprios dados (ritmos, energia, conclusão) para simular cenários antes de decidir.',
    category: 'simulacao',
    requires_ai: false,
    default_params: { amostra_minima_dias: 7 }
  },
  {
    key: 'emotional_map',
    name: 'Mapa Emocional × Produtividade',
    description:
      'Correlaciona humor/energia informados com produtividade, com privacidade primeiro (processamento local, sem diagnóstico).',
    category: 'bem-estar',
    requires_ai: false,
    default_params: { escala: 5, exige_consentimento: true }
  },
  {
    key: 'shutdown_ritual',
    name: 'Ritual de Encerramento',
    description:
      'Fecha o dia com revisão do concluído, captura de pendências e preparação do amanhã (Deep Work / shutdown).',
    category: 'foco',
    requires_ai: false,
    default_params: { horario_sugerido: '18:00', itens_amanha: 3 }
  }
]);

const SEED_MARK = 'kairo-smart-features-v1';

export function ensureSmartFeaturesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS smart_features (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'geral',
      requires_ai INTEGER NOT NULL DEFAULT 0 CHECK (requires_ai IN (0, 1)),
      default_params TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS smart_feature_config (
      feature_key TEXT PRIMARY KEY REFERENCES smart_features (key) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      params TEXT NOT NULL DEFAULT '{}',
      ai_connection_id INTEGER,
      ai_artifact_id INTEGER,
      updated_by INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS smart_feature_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_key TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_id INTEGER,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS smart_seed_state (
      seed_key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function parseJson(value, fallback) {
  try {
    const p = JSON.parse(value);
    return p ?? fallback;
  } catch {
    return fallback;
  }
}

export function createSmartFeaturesService({ db, aiService = null } = {}) {
  if (!db) throw new Error('A suíte inteligente exige uma instância de banco de dados.');
  ensureSmartFeaturesSchema(db);

  function registrarAuditoria(featureKey, action, actorId, detail) {
    db.run(
      'INSERT INTO smart_feature_audit (feature_key, action, actor_id, detail) VALUES (?, ?, ?, ?)',
      [featureKey, action, actorId ?? null, detail ? String(detail).slice(0, 400) : null]
    );
  }

  function garantirConfig(featureKey) {
    let cfg = db.get('SELECT * FROM smart_feature_config WHERE feature_key = ?', [featureKey]);
    if (!cfg) {
      const feature = db.get('SELECT default_params FROM smart_features WHERE key = ?', [
        featureKey
      ]);
      db.run('INSERT INTO smart_feature_config (feature_key, enabled, params) VALUES (?, 0, ?)', [
        featureKey,
        feature?.default_params ?? '{}'
      ]);
      cfg = db.get('SELECT * FROM smart_feature_config WHERE feature_key = ?', [featureKey]);
    }
    return cfg;
  }

  function serialize(feature) {
    const cfg = garantirConfig(feature.key);
    return {
      key: feature.key,
      name: feature.name,
      description: feature.description,
      category: feature.category,
      requires_ai: Boolean(feature.requires_ai),
      default_params: parseJson(feature.default_params, {}),
      enabled: Boolean(cfg.enabled),
      params: parseJson(cfg.params, {}),
      ai_connection_id: cfg.ai_connection_id,
      ai_artifact_id: cfg.ai_artifact_id,
      updated_at: cfg.updated_at
    };
  }

  function list() {
    return db.all('SELECT * FROM smart_features ORDER BY key ASC').map((f) => serialize(f));
  }

  function get(key) {
    const feature = db.get('SELECT * FROM smart_features WHERE key = ?', [key]);
    if (!feature) throw notFound('Recurso inteligente não encontrado.', 'RECURSO_NAO_ENCONTRADO');
    return serialize(feature);
  }

  function isEnabled(key) {
    const cfg = db.get('SELECT enabled FROM smart_feature_config WHERE feature_key = ?', [key]);
    return Boolean(cfg && Number(cfg.enabled) === 1);
  }

  function params(key) {
    const cfg = db.get('SELECT params FROM smart_feature_config WHERE feature_key = ?', [key]);
    const feature = db.get('SELECT default_params FROM smart_features WHERE key = ?', [key]);
    return { ...parseJson(feature?.default_params, {}), ...parseJson(cfg?.params, {}) };
  }

  function assertEnabled(key) {
    if (!isEnabled(key)) {
      throw unprocessable('Este recurso está desativado pelo administrador.', 'RECURSO_DESATIVADO');
    }
  }

  function updateConfig(key, input, actorId) {
    const feature = db.get('SELECT * FROM smart_features WHERE key = ?', [key]);
    if (!feature) throw notFound('Recurso inteligente não encontrado.', 'RECURSO_NAO_ENCONTRADO');
    const atual = garantirConfig(key);

    // Vínculo de IA opcional: valida se a conexão existe (quando o gateway está disponível).
    if (input.ai_connection_id != null && aiService) {
      aiService.getConnection(input.ai_connection_id); // lança se não existir
    }

    const enabled = input.enabled === undefined ? Boolean(atual.enabled) : Boolean(input.enabled);
    const novosParams =
      input.params === undefined
        ? parseJson(atual.params, {})
        : { ...parseJson(atual.params, {}), ...input.params };

    db.run(
      `UPDATE smart_feature_config
       SET enabled = ?, params = ?, ai_connection_id = ?, ai_artifact_id = ?,
           updated_by = ?, updated_at = datetime('now')
       WHERE feature_key = ?`,
      [
        enabled ? 1 : 0,
        JSON.stringify(novosParams),
        input.ai_connection_id === undefined ? atual.ai_connection_id : input.ai_connection_id,
        input.ai_artifact_id === undefined ? atual.ai_artifact_id : input.ai_artifact_id,
        actorId ?? null,
        key
      ]
    );
    registrarAuditoria(key, 'config.update', actorId, `enabled=${enabled}`);
    return get(key);
  }

  // Dry-run real: valida a configuração e a disponibilidade da IA vinculada.
  function test(key) {
    const cfg = get(key);
    const checagens = [];
    checagens.push({ nome: 'recurso_registrado', ok: true });
    checagens.push({
      nome: 'parametros_validos',
      ok: cfg.params && typeof cfg.params === 'object'
    });
    if (cfg.ai_connection_id && aiService) {
      let saudavel;
      try {
        const conn = aiService.getConnection(cfg.ai_connection_id);
        saudavel = conn.is_active;
      } catch {
        saudavel = false;
      }
      checagens.push({ nome: 'ia_vinculada_ativa', ok: saudavel });
    }
    const aprovado = checagens.every((c) => c.ok);
    registrarAuditoria(key, 'config.test', null, aprovado ? 'ok' : 'falha');
    return { feature: key, ready: aprovado, checks: checagens };
  }

  function listAudit(key, limit = 100) {
    const max = Math.max(1, Math.min(500, Number(limit) || 100));
    return db.all(
      'SELECT * FROM smart_feature_audit WHERE feature_key = ? ORDER BY id DESC LIMIT ?',
      [key, max]
    );
  }

  // Seed idempotente do catálogo (uma única vez; itens excluídos não recriam).
  function ensureSeed() {
    if (db.get('SELECT 1 AS f FROM smart_seed_state WHERE seed_key = ?', [SEED_MARK])) {
      return { seeded: false };
    }
    db.transaction(() => {
      for (const f of SMART_FEATURES) {
        db.run(
          `INSERT INTO smart_features (key, name, description, category, requires_ai, default_params)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             name = excluded.name, description = excluded.description,
             category = excluded.category, requires_ai = excluded.requires_ai,
             default_params = excluded.default_params`,
          [
            f.key,
            f.name,
            f.description,
            f.category,
            f.requires_ai ? 1 : 0,
            JSON.stringify(f.default_params || {})
          ]
        );
        garantirConfig(f.key);
      }
      db.run('INSERT OR IGNORE INTO smart_seed_state (seed_key) VALUES (?)', [SEED_MARK]);
    });
    return { seeded: true, count: SMART_FEATURES.length };
  }

  return {
    ensureSchema: () => ensureSmartFeaturesSchema(db),
    ensureSeed,
    list,
    get,
    isEnabled,
    params,
    assertEnabled,
    updateConfig,
    test,
    listAudit
  };
}
