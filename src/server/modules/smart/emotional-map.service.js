// ============================================================================
// Kairo — Mapa Emocional × Produtividade (Tarefa 35.11)
// ----------------------------------------------------------------------------
// Correlaciona humor e energia AUTORRELATADOS com a produtividade real (horas
// concluídas na agenda), com privacidade em primeiro lugar: processamento local,
// consentimento explícito e SEM diagnóstico clínico. Determinístico (correlação
// de Pearson). A IA é opcional (interpreta padrões com cautela em outra camada).
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

const FEATURE_KEY = 'emotional_map';

export function ensureEmotionalMapSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS emotional_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      check_date DATE NOT NULL,
      mood INTEGER NOT NULL CHECK (mood >= 1),
      energy INTEGER NOT NULL CHECK (energy >= 1),
      note TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      UNIQUE (user_id, check_date)
    );
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_emotional_checkins_user ON emotional_checkins (user_id, check_date);'
  );
}

// Coeficiente de correlação de Pearson (retorna null se indefinido).
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mediaX = xs.reduce((a, b) => a + b, 0) / n;
  const mediaY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mediaX;
    const dy = ys[i] - mediaY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? null : Number((num / den).toFixed(2));
}

export function createEmotionalMapService({
  db,
  smartFeaturesService,
  now = () => new Date()
} = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('O Mapa Emocional exige banco de dados e a governança inteligente.');
  }
  ensureEmotionalMapSchema(db);

  function dataDeHoje() {
    return now().toISOString().slice(0, 10);
  }

  function subtrairDias(dataIso, dias) {
    const d = new Date(`${dataIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - dias);
    return d.toISOString().slice(0, 10);
  }

  // Registra um check-in emocional do dia (um por data, atualizável).
  function record(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const escala = Math.max(2, Math.min(10, Number(params.escala) || 5));
    const exigeConsentimento = params.exige_consentimento !== false;

    if (exigeConsentimento && input.consent !== true) {
      throw unprocessable(
        'Este recurso processa dados sensíveis de bem-estar e exige consentimento explícito.',
        'CONSENTIMENTO_NECESSARIO'
      );
    }

    const mood = Math.round(Number(input.mood));
    const energy = Math.round(Number(input.energy));
    if (!Number.isFinite(mood) || mood < 1 || mood > escala) {
      throw unprocessable(`Humor deve estar entre 1 e ${escala}.`, 'HUMOR_INVALIDO');
    }
    if (!Number.isFinite(energy) || energy < 1 || energy > escala) {
      throw unprocessable(`Energia deve estar entre 1 e ${escala}.`, 'ENERGIA_INVALIDA');
    }
    const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : dataDeHoje();
    const note = input.note ? String(input.note).trim().slice(0, 500) : null;

    db.run(
      `INSERT INTO emotional_checkins (user_id, check_date, mood, energy, note)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, check_date)
       DO UPDATE SET mood = excluded.mood, energy = excluded.energy, note = excluded.note`,
      [userId, date, mood, energy, note]
    );
    return db.get('SELECT * FROM emotional_checkins WHERE user_id = ? AND check_date = ?', [
      userId,
      date
    ]);
  }

  // Correlaciona humor/energia com a produtividade real numa janela.
  function map(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const janelaDias = Math.max(1, Math.min(180, Number(input.window_days) || 14));
    const hoje = dataDeHoje();
    const inicio = subtrairDias(hoje, janelaDias);

    const checkins = db.all(
      `SELECT check_date, mood, energy FROM emotional_checkins
        WHERE user_id = ? AND check_date BETWEEN ? AND ?
        ORDER BY check_date ASC`,
      [userId, inicio, hoje]
    );

    // Produtividade diária = horas concluídas na agenda.
    const produtividadePorDia = new Map();
    for (const linha of db.all(
      `SELECT event_date, SUM(duration_hours) AS horas
         FROM agenda_events
        WHERE user_id = ? AND is_completed = 1 AND event_date BETWEEN ? AND ?
        GROUP BY event_date`,
      [userId, inicio, hoje]
    )) {
      produtividadePorDia.set(linha.event_date, Number(linha.horas) || 0);
    }

    const series = checkins.map((c) => ({
      date: c.check_date,
      mood: c.mood,
      energy: c.energy,
      productive_hours: produtividadePorDia.get(c.check_date) || 0
    }));

    // Correlaciona apenas os dias com ambos os sinais presentes.
    const paresComProd = series.filter((s) => produtividadePorDia.has(s.date));
    const humor = paresComProd.map((s) => s.mood);
    const energia = paresComProd.map((s) => s.energy);
    const produtividade = paresComProd.map((s) => s.productive_hours);

    return {
      window_days: janelaDias,
      sample_days: series.length,
      correlated_days: paresComProd.length,
      series,
      correlations: {
        mood_productivity: pearson(humor, produtividade),
        energy_productivity: pearson(energia, produtividade)
      },
      disclaimer:
        'Este é um mapa de autoconhecimento, não um diagnóstico. Os dados são processados localmente e sob seu consentimento.'
    };
  }

  return { record, map };
}
