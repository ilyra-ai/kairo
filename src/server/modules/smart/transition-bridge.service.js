// ============================================================================
// Kairo — Ponte de Transição entre Tarefas (Tarefa 35.4)
// ----------------------------------------------------------------------------
// Micro-ritual guiado entre uma tarefa e a próxima (respiração, contagem ou som
// curto) para reduzir o custo de transição — barreira central no TDAH/TEA. O
// roteiro é determinístico e derivado dos parâmetros do administrador; a ponte
// também prepara a próxima tarefa. Registra transições concluídas para métricas.
// ============================================================================

const FEATURE_KEY = 'transition_bridge';
const TIPOS_VALIDOS = new Set(['respiracao', 'contagem', 'som']);

export function ensureTransitionBridgeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transition_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      from_task TEXT,
      to_task TEXT,
      ritual_type TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
      completed INTEGER NOT NULL DEFAULT 1 CHECK (completed IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_transition_logs_user ON transition_logs (user_id, created_at);'
  );
}

// Constrói o roteiro de passos do ritual, de forma determinística, distribuindo
// a duração total configurada entre os passos de cada tipo.
function montarPassos(tipo, duracaoSeg) {
  const total = Math.max(5, Math.min(300, Number(duracaoSeg) || 30));
  if (tipo === 'respiracao') {
    // Ciclo 4-4-4 (inspirar/segurar/expirar) repetido até preencher a duração.
    const passoCiclo = 12;
    const ciclos = Math.max(1, Math.round(total / passoCiclo));
    const passos = [];
    for (let i = 0; i < ciclos; i += 1) {
      passos.push(
        { label: 'Inspire', seconds: 4 },
        { label: 'Segure', seconds: 4 },
        { label: 'Expire', seconds: 4 }
      );
    }
    return passos;
  }
  if (tipo === 'contagem') {
    // Contagem regressiva de N até 1 (N derivado da duração).
    const n = Math.max(3, Math.min(10, Math.round(total / 3)));
    const passos = [];
    for (let i = n; i >= 1; i -= 1) passos.push({ label: String(i), seconds: 3 });
    passos.push({ label: 'Comece', seconds: 3 });
    return passos;
  }
  // som: um sinal curto de preparação seguido de foco.
  return [
    { label: 'Sinal de preparação', seconds: Math.min(5, total) },
    { label: 'Assumir o foco', seconds: Math.max(1, total - 5) }
  ];
}

export function createTransitionBridgeService({ db, smartFeaturesService } = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('A ponte de transição exige banco de dados e a governança inteligente.');
  }
  ensureTransitionBridgeSchema(db);

  // Gera o roteiro do ritual e a preparação da próxima tarefa (não persiste).
  function plan(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const tipo = TIPOS_VALIDOS.has(params.tipo) ? params.tipo : 'respiracao';
    const duracaoSeg = Number(params.duracao_seg) || 30;
    const passos = montarPassos(tipo, duracaoSeg);
    const totalSegundos = passos.reduce((soma, p) => soma + p.seconds, 0);

    const fromTask = input.from ? String(input.from).trim().slice(0, 200) : null;
    const toTask = input.to ? String(input.to).trim().slice(0, 200) : null;

    return {
      ritual_type: tipo,
      total_seconds: totalSegundos,
      sound_enabled: params.som_permitido !== false && tipo === 'som',
      steps: passos,
      from_task: fromTask,
      to_task: toTask,
      next_prep: toTask
        ? `Prepare o ambiente e o material para: ${toTask}.`
        : 'Defina claramente a próxima tarefa antes de começar.'
    };
  }

  // Registra uma transição concluída (ou abandonada) para métricas de aderência.
  function complete(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const tipo = TIPOS_VALIDOS.has(params.tipo) ? params.tipo : 'respiracao';
    const duracaoBruta = Number(input.duration_seconds);
    const duracao =
      Number.isFinite(duracaoBruta) && duracaoBruta >= 0
        ? Math.min(Math.floor(duracaoBruta), 3600)
        : 0;
    const completed = input.completed === false ? 0 : 1;
    const fromTask = input.from ? String(input.from).trim().slice(0, 200) : null;
    const toTask = input.to ? String(input.to).trim().slice(0, 200) : null;

    const resultado = db.run(
      'INSERT INTO transition_logs (user_id, from_task, to_task, ritual_type, duration_seconds, completed) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, fromTask, toTask, tipo, duracao, completed]
    );
    return {
      id: resultado.lastInsertRowid,
      completed: Boolean(completed),
      duration_seconds: duracao
    };
  }

  // Estatísticas de aderência às transições (para o painel do usuário).
  function stats(userId) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const linha = db.get(
      `SELECT COUNT(*) AS total,
              SUM(completed) AS concluidas,
              AVG(duration_seconds) AS media_seg
         FROM transition_logs
        WHERE user_id = ?`,
      [userId]
    );
    const total = linha?.total || 0;
    const concluidas = linha?.concluidas || 0;
    return {
      total,
      completed: concluidas,
      completion_ratio: total > 0 ? Number((concluidas / total).toFixed(2)) : 0,
      average_seconds: linha?.media_seg ? Math.round(linha.media_seg) : 0
    };
  }

  return { plan, complete, stats };
}
