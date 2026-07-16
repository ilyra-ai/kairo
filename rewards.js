// ============================================================================
//  Kairo — Motor de Recompensa Dopaminérgica (base científica RPE)
//  Decide recompensas VARIÁVEIS no servidor (anti-fraude + aleatoriedade real),
//  persiste moedas/streaks/coleção/recordes, respeita os 9 geradores liga/desliga,
//  registra histórico para métricas e coleta avaliação (CSAT 1–5) do presente.
// ============================================================================

// Os 9 geradores de dopamina (chave estável + rótulo)
export const DOPAMINE_GENERATORS = [
  { key: 'recompensa_variavel', label: 'Recompensa Variável + Jackpot' },
  { key: 'bau_loot',            label: 'Baú / Loot Colecionável' },
  { key: 'combo',               label: 'Combo / Momentum' },
  { key: 'micro_conclusoes',    label: 'Micro-conclusões' },
  { key: 'antecipacao',         label: 'Antecipação Visível' },
  { key: 'mensagens_rpe',       label: 'Mensagens "melhor que o esperado"' },
  { key: 'multissensorial',     label: 'Celebração Multissensorial' },
  { key: 'dopamenu',            label: 'Dopamenu (cardápio pessoal)' },
  { key: 'surpresa',            label: 'Recompensa em Momento Surpresa' }
];

const COLLECTIBLES = [
  '🌟 Estrela Radiante', '🔥 Chama do Foco', '💎 Diamante Raro', '🏆 Troféu de Ouro',
  '🎖️ Medalha Gamma', '🚀 Foguete Turbo', '🧠 Cérebro Zen', '⚡ Raio Dopamínico',
  '🎁 Caixa Misteriosa', '🌈 Prisma da Constância'
];

const RPE_MESSAGES = [
  'Melhor do que o esperado! 🎉', 'Você mandou muito bem!', 'Isso foi difícil e você fez! 💪',
  'Sequência imparável! 🔥', 'Recorde à vista! 🏅', 'O foco está com você hoje!',
  'Dopamina liberada — continue! ✨', 'Mais um vencido, orgulho de você!'
];

const DEFAULT_DOPAMENU = [
  { category: 'entrada', label: 'Alongar por 2 minutos' },
  { category: 'entrada', label: 'Beber água / café' },
  { category: 'principal', label: 'Ouvir 1 música favorita' },
  { category: 'principal', label: 'Caminhar 5 minutos' },
  { category: 'sobremesa', label: 'Ver um vídeo curto engraçado' },
  { category: 'sobremesa', label: 'Mandar mensagem para alguém querido' }
];

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Schema + seeds
// ---------------------------------------------------------------------------
export async function ensureRewardsSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_gamification (
      user_id INTEGER PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0,
      current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      today_date TEXT,
      today_count INTEGER NOT NULL DEFAULT 0,
      best_day_count INTEGER NOT NULL DEFAULT 0,
      total_completions INTEGER NOT NULL DEFAULT 0,
      combo INTEGER NOT NULL DEFAULT 0,
      collectibles TEXT NOT NULL DEFAULT '[]',
      last_completion_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS dopamenu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'principal',
      label TEXT NOT NULL
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS dopamine_config (
      feature_key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_reward_config (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reward_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tier TEXT NOT NULL,
      generator TEXT,
      coins INTEGER NOT NULL DEFAULT 0,
      chest INTEGER NOT NULL DEFAULT 0,
      collectible TEXT,
      jackpot INTEGER NOT NULL DEFAULT 0,
      context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reward_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      reward_event_id INTEGER NOT NULL,
      generator TEXT,
      rating INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed dos 9 geradores (todos ligados por padrão)
  for (const g of DOPAMINE_GENERATORS) {
    await db.run('INSERT OR IGNORE INTO dopamine_config (feature_key, enabled) VALUES (?, 1)', [g.key]);
  }
  // Seed das flags de IA (desligadas por padrão — dependem de IA configurada)
  await db.run("INSERT OR IGNORE INTO ai_reward_config (key, value) VALUES ('nao_repetir', 0)");
  await db.run("INSERT OR IGNORE INTO ai_reward_config (key, value) VALUES ('aprender_preferencias', 0)");
}

async function getUserRow(db, userId) {
  let row = await db.get('SELECT * FROM user_gamification WHERE user_id = ?', [userId]);
  if (!row) {
    // today_date fica NULL: a 1ª conclusão entra no ramo "novo dia" e o streak vira 1
    await db.run('INSERT INTO user_gamification (user_id) VALUES (?)', [userId]);
    // Seed do dopamenu padrão para o usuário
    for (const item of DEFAULT_DOPAMENU) {
      await db.run('INSERT INTO dopamenu (user_id, category, label) VALUES (?, ?, ?)', [userId, item.category, item.label]);
    }
    row = await db.get('SELECT * FROM user_gamification WHERE user_id = ?', [userId]);
  }
  return row;
}

export async function getConfig(db) {
  const rows = await db.all('SELECT feature_key, enabled FROM dopamine_config');
  const generators = {};
  for (const g of DOPAMINE_GENERATORS) generators[g.key] = { label: g.label, enabled: true };
  for (const r of rows) if (generators[r.feature_key]) generators[r.feature_key].enabled = !!r.enabled;
  const ai = {};
  const aiRows = await db.all('SELECT key, value FROM ai_reward_config');
  for (const r of aiRows) ai[r.key] = !!r.value;
  return { generators, ai };
}

export async function setGeneratorEnabled(db, key, enabled) {
  const valid = DOPAMINE_GENERATORS.some(g => g.key === key);
  if (!valid) throw new Error('Gerador de dopamina inválido.');
  await db.run('INSERT OR REPLACE INTO dopamine_config (feature_key, enabled) VALUES (?, ?)', [key, enabled ? 1 : 0]);
  return { key, enabled: !!enabled };
}

export async function setAiFlag(db, key, value) {
  if (!['nao_repetir', 'aprender_preferencias'].includes(key)) throw new Error('Flag de IA inválida.');
  await db.run('INSERT OR REPLACE INTO ai_reward_config (key, value) VALUES (?, ?)', [key, value ? 1 : 0]);
  return { key, value: !!value };
}

async function isOn(db, key) {
  const r = await db.get('SELECT enabled FROM dopamine_config WHERE feature_key = ?', [key]);
  return r ? !!r.enabled : true;
}

// ---------------------------------------------------------------------------
// Núcleo: registrar conclusão e decidir a recompensa VARIÁVEL (no servidor)
// ---------------------------------------------------------------------------
export async function registerCompletion(db, userId, context = {}) {
  const row = await getUserRow(db, userId);
  const today = todayStr();

  // Streak: baseado no dia da última conclusão
  const lastDate = row.today_date;
  let currentStreak = row.current_streak;
  let todayCount = row.today_count;
  if (lastDate === today) {
    todayCount += 1;
  } else {
    // Novo dia
    const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
    const p = (n) => String(n).padStart(2, '0');
    const ontemStr = `${ontem.getFullYear()}-${p(ontem.getMonth() + 1)}-${p(ontem.getDate())}`;
    currentStreak = (lastDate === ontemStr) ? currentStreak + 1 : 1;
    todayCount = 1;
  }
  const longestStreak = Math.max(row.longest_streak, currentStreak);
  const bestDayCount = Math.max(row.best_day_count, todayCount);
  const totalCompletions = row.total_completions + 1;

  // Combo: se a última conclusão foi há < 10 min, aumenta o multiplicador
  let combo = 1;
  if (await isOn(db, 'combo') && row.last_completion_at) {
    const diffMin = (Date.now() - new Date(row.last_completion_at + 'Z').getTime()) / 60000;
    combo = (diffMin >= 0 && diffMin <= 10) ? Math.min(row.combo + 1, 10) : 1;
  }

  // --- Decisão da recompensa VARIÁVEL (razão variável + RPE) ---
  const variavelOn = await isOn(db, 'recompensa_variavel');
  const bauOn = await isOn(db, 'bau_loot');
  const surpresaOn = await isOn(db, 'surpresa');

  // Anti-repetição: se a IA "não repetir" estiver ligada, evita o mesmo tier/coletável do último evento
  const aiNoRepeat = (await db.get("SELECT value FROM ai_reward_config WHERE key='nao_repetir'"))?.value;
  const lastEvent = await db.get('SELECT tier, collectible FROM reward_events WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);

  let tier = 'normal';
  let jackpot = 0;
  if (variavelOn) {
    // Sorteio ponderado: normal 68%, grande 22%, jackpot 4%, baú 6%
    let roll = Math.random();
    if (aiNoRepeat && lastEvent) {
      // reduz a chance de repetir exatamente o mesmo tier (re-sorteia uma vez)
      const first = roll;
      const provisional = first < 0.68 ? 'normal' : first < 0.90 ? 'grande' : first < 0.94 ? 'jackpot' : 'bau';
      if (provisional === lastEvent.tier) roll = Math.random();
    }
    tier = roll < 0.68 ? 'normal' : roll < 0.90 ? 'grande' : roll < 0.94 ? 'jackpot' : (bauOn ? 'bau' : 'grande');
    if (tier === 'jackpot') jackpot = 1;
  } else {
    tier = 'normal'; // recompensa base fixa quando o variável está desligado
  }

  // Moedas por tier (× combo)
  const baseCoins = { normal: 10, grande: 30, jackpot: 100, bau: 20 }[tier] || 10;
  const coins = baseCoins * combo;

  // Baú/coletável
  let chest = 0;
  let collectible = null;
  if ((tier === 'bau' || tier === 'jackpot') && bauOn) {
    chest = 1;
    let pool = COLLECTIBLES;
    if (aiNoRepeat && lastEvent && lastEvent.collectible) pool = COLLECTIBLES.filter(c => c !== lastEvent.collectible);
    collectible = pool[Math.floor(Math.random() * pool.length)];
    const col = JSON.parse(row.collectibles || '[]');
    col.push({ item: collectible, at: new Date().toISOString() });
    row.collectibles = JSON.stringify(col);
  }

  // Mensagem RPE (se ligado)
  let message = 'Atividade concluída!';
  if (await isOn(db, 'mensagens_rpe')) {
    if (todayCount === bestDayCount && todayCount > 1) message = `🏅 Recorde do dia: ${todayCount} conclusões!`;
    else if (currentStreak >= 2) message = `🔥 ${currentStreak} dias seguidos! ${RPE_MESSAGES[Math.floor(Math.random()*RPE_MESSAGES.length)]}`;
    else message = RPE_MESSAGES[Math.floor(Math.random() * RPE_MESSAGES.length)];
  }

  // Persiste o estado do usuário
  const newCoins = row.coins + coins;
  await db.run(
    `UPDATE user_gamification SET coins = ?, current_streak = ?, longest_streak = ?, today_date = ?,
       today_count = ?, best_day_count = ?, total_completions = ?, combo = ?, collectibles = ?,
       last_completion_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
    [newCoins, currentStreak, longestStreak, today, todayCount, bestDayCount, totalCompletions,
     (await isOn(db,'combo')) ? combo : 0, row.collectibles, userId]
  );

  // Registra o evento (para métricas e anti-repetição)
  const generator = jackpot ? 'recompensa_variavel' : (chest ? 'bau_loot' : (combo > 1 ? 'combo' : 'recompensa_variavel'));
  const result = await db.run(
    `INSERT INTO reward_events (user_id, tier, generator, coins, chest, collectible, jackpot, context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, tier, generator, coins, chest, collectible, jackpot, context.tipo || 'atividade']
  );

  // Antecipação: quantas conclusões faltam para o próximo baú garantido (a cada 5)
  const antecipacaoOn = await isOn(db, 'antecipacao');
  const proxBau = antecipacaoOn ? (5 - (totalCompletions % 5)) % 5 : null;

  // Oferta do dopamenu (se ligado) — em tarefas difíceis (carga alta) ou aleatoriamente
  let dopamenuOffer = null;
  if (await isOn(db, 'dopamenu') && (context.cargaAlta || Math.random() < 0.25)) {
    const menu = await db.all('SELECT category, label FROM dopamenu WHERE user_id = ?', [userId]);
    if (menu.length) dopamenuOffer = menu[Math.floor(Math.random() * menu.length)];
  }

  return {
    event_id: result.lastID,
    tier, jackpot: !!jackpot, coins, coins_total: newCoins, combo,
    chest: !!chest, collectible, message,
    multissensorial: await isOn(db, 'multissensorial'),
    generator,
    streak: currentStreak, longest_streak: longestStreak,
    today_count: todayCount, best_day_count: bestDayCount, total: totalCompletions,
    antecipacao: proxBau,
    dopamenu: dopamenuOffer,
    surpresa: surpresaOn && Math.random() < 0.05 ? RPE_MESSAGES[Math.floor(Math.random()*RPE_MESSAGES.length)] : null
  };
}

// Avaliação do presente (CSAT 1–5) — salva na memória do usuário
export async function submitFeedback(db, userId, eventId, rating) {
  const r = parseInt(rating);
  if (!(r >= 1 && r <= 5)) throw new Error('A avaliação deve ser de 1 a 5.');
  const ev = await db.get('SELECT id, generator FROM reward_events WHERE id = ? AND user_id = ?', [eventId, userId]);
  if (!ev) throw new Error('Evento de recompensa não encontrado.');
  await db.run(
    'INSERT INTO reward_feedback (user_id, reward_event_id, generator, rating) VALUES (?, ?, ?, ?)',
    [userId, eventId, ev.generator, r]
  );
  return { ok: true };
}

export async function getState(db, userId) {
  const row = await getUserRow(db, userId);
  return {
    coins: row.coins, current_streak: row.current_streak, longest_streak: row.longest_streak,
    today_count: row.today_count, best_day_count: row.best_day_count,
    total_completions: row.total_completions, combo: row.combo,
    collectibles: JSON.parse(row.collectibles || '[]')
  };
}

// Dopamenu CRUD
export async function getDopamenu(db, userId) {
  return db.all('SELECT id, category, label FROM dopamenu WHERE user_id = ? ORDER BY id ASC', [userId]);
}
export async function addDopamenuItem(db, userId, { category, label }) {
  if (!label) throw new Error('Informe o item do dopamenu.');
  const r = await db.run('INSERT INTO dopamenu (user_id, category, label) VALUES (?, ?, ?)', [userId, category || 'principal', label]);
  return db.get('SELECT id, category, label FROM dopamenu WHERE id = ?', [r.lastID]);
}
export async function deleteDopamenuItem(db, userId, id) {
  await db.run('DELETE FROM dopamenu WHERE id = ? AND user_id = ?', [id, userId]);
}

// ---------------------------------------------------------------------------
// Dashboard Executivo (nível big tech) — dados reais
// ---------------------------------------------------------------------------
export async function getExecutiveDashboard(db) {
  // Top 10 usuários (por conclusões e moedas)
  const top10 = await db.all(`
    SELECT u.id, u.name, u.email, u.plan,
           g.total_completions, g.coins, g.current_streak, g.longest_streak
    FROM user_gamification g JOIN users u ON u.id = g.user_id
    ORDER BY g.total_completions DESC, g.coins DESC LIMIT 10
  `);

  // Eficácia por gerador (uso × satisfação média)
  const generators = await db.all(`
    SELECT re.generator,
           COUNT(re.id) AS usos,
           COALESCE(AVG(rf.rating), 0) AS satisfacao_media,
           SUM(re.coins) AS moedas_geradas
    FROM reward_events re
    LEFT JOIN reward_feedback rf ON rf.reward_event_id = re.id
    GROUP BY re.generator ORDER BY usos DESC
  `);

  // O que os usuários mais gostam (satisfação por gerador via feedback)
  const preferencias = await db.all(`
    SELECT generator, COUNT(*) AS avaliacoes, ROUND(AVG(rating), 2) AS media
    FROM reward_feedback GROUP BY generator ORDER BY media DESC
  `);

  // MÉTRICA 1 — Retenção por coorte (D1/D7/D30): % de usuários que voltaram a concluir algo
  const cohort = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM users) AS total_usuarios,
      (SELECT COUNT(DISTINCT user_id) FROM reward_events WHERE created_at >= datetime('now','-1 day')) AS ativos_d1,
      (SELECT COUNT(DISTINCT user_id) FROM reward_events WHERE created_at >= datetime('now','-7 day')) AS ativos_d7,
      (SELECT COUNT(DISTINCT user_id) FROM reward_events WHERE created_at >= datetime('now','-30 day')) AS ativos_d30
  `);

  // MÉTRICA 2 — DAU/MAU (stickiness)
  const dau = cohort.ativos_d1;
  const mau = cohort.ativos_d30 || 1;
  const stickiness = Math.round((dau / mau) * 100);

  // MÉTRICA 3 — Churn / usuários em risco (sem conclusão há 7+ dias)
  const risco = await db.all(`
    SELECT u.id, u.name, u.email,
      (SELECT MAX(created_at) FROM reward_events WHERE user_id = u.id) AS ultima_atividade
    FROM users u
    WHERE (SELECT MAX(created_at) FROM reward_events WHERE user_id = u.id) IS NULL
       OR (SELECT MAX(created_at) FROM reward_events WHERE user_id = u.id) < datetime('now','-7 day')
    ORDER BY ultima_atividade ASC LIMIT 10
  `);

  // MÉTRICA 4 — A/B Testing das recompensas (desempenho por tier: satisfação média)
  const abTiers = await db.all(`
    SELECT re.tier, COUNT(re.id) AS ocorrencias, COALESCE(ROUND(AVG(rf.rating),2),0) AS satisfacao
    FROM reward_events re LEFT JOIN reward_feedback rf ON rf.reward_event_id = re.id
    GROUP BY re.tier ORDER BY satisfacao DESC
  `);

  // MÉTRICA 5 — RFM + LTV (Recência, Frequência, Valor=moedas) por top usuários
  const rfm = await db.all(`
    SELECT u.name, u.email,
      CAST(julianday('now') - julianday(COALESCE((SELECT MAX(created_at) FROM reward_events WHERE user_id=u.id), u.created_at)) AS INT) AS recencia_dias,
      g.total_completions AS frequencia,
      g.coins AS valor_moedas
    FROM users u JOIN user_gamification g ON g.user_id = u.id
    ORDER BY valor_moedas DESC LIMIT 10
  `);

  // Totais gerais
  const totais = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM reward_events) AS total_recompensas,
      (SELECT COALESCE(SUM(coins),0) FROM reward_events) AS total_moedas,
      (SELECT COUNT(*) FROM reward_events WHERE jackpot = 1) AS total_jackpots,
      (SELECT COALESCE(ROUND(AVG(rating),2),0) FROM reward_feedback) AS satisfacao_geral
  `);

  return {
    top10, generators, preferencias,
    metricas: {
      retencao: { d1: cohort.ativos_d1, d7: cohort.ativos_d7, d30: cohort.ativos_d30, total: cohort.total_usuarios },
      stickiness: { dau, mau, indice: stickiness },
      churn: risco,
      ab_testing: abTiers,
      rfm
    },
    totais
  };
}
