// ============================================================================
// Kairo — Mapa Emocional × Produtividade (Tarefa 35.11)
// ----------------------------------------------------------------------------
// Correlaciona humor e energia AUTORRELATADOS com a produtividade real (horas
// concluídas na agenda), com privacidade em primeiro lugar: processamento local,
// consentimento explícito e SEM diagnóstico clínico. Determinístico (correlação
// de Pearson). A IA é opcional (interpreta padrões com cautela em outra camada).
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';
import { decryptString, encryptString } from '../../security/crypto.js';

const FEATURE_KEY = 'emotional_map';

function createSecureTable(db, tableName = 'emotional_checkins') {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      check_date DATE NOT NULL,
      encrypted_payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      UNIQUE (user_id, check_date)
    );
  `);
}

function payloadAad(userId, date) {
  return `kairo:emotional-checkin:${userId}:${date}`;
}

export function ensureEmotionalMapSchema(db, encryptionKey) {
  const existing = db.all('PRAGMA table_info(emotional_checkins)');
  if (existing.length === 0) {
    createSecureTable(db);
  } else if (!existing.some((column) => column.name === 'encrypted_payload')) {
    const legacyRows = db.all(
      'SELECT id, user_id, check_date, mood, energy, note, created_at FROM emotional_checkins'
    );
    db.transaction(() => {
      createSecureTable(db, 'emotional_checkins_secure');
      for (const row of legacyRows) {
        const encrypted = encryptString(
          JSON.stringify({ mood: row.mood, energy: row.energy, note: row.note ?? null }),
          {
            aad: payloadAad(row.user_id, row.check_date),
            key: encryptionKey
          }
        );
        db.run(
          `INSERT INTO emotional_checkins_secure
            (id, user_id, check_date, encrypted_payload, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [row.id, row.user_id, row.check_date, encrypted, row.created_at]
        );
      }
      db.exec('DROP TABLE emotional_checkins;');
      db.exec('ALTER TABLE emotional_checkins_secure RENAME TO emotional_checkins;');
    });
  }
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
  encryptionKey,
  now = () => new Date()
} = {}) {
  if (!db || !smartFeaturesService) {
    throw new Error('O Mapa Emocional exige banco de dados e a governança inteligente.');
  }
  ensureEmotionalMapSchema(db, encryptionKey);

  function encryptPayload(userId, date, payload) {
    return encryptString(JSON.stringify(payload), {
      aad: payloadAad(userId, date),
      key: encryptionKey
    });
  }

  function decryptPayload(row) {
    return JSON.parse(
      decryptString(row.encrypted_payload, {
        aad: payloadAad(row.user_id, row.check_date),
        key: encryptionKey
      })
    );
  }

  function serializeCheckin(row) {
    const payload = decryptPayload(row);
    return {
      id: row.id,
      user_id: row.user_id,
      check_date: row.check_date,
      mood: payload.mood,
      energy: payload.energy,
      note: payload.note ?? null,
      created_at: row.created_at
    };
  }

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

    const encrypted = encryptPayload(userId, date, { mood, energy, note });
    db.run(
      `INSERT INTO emotional_checkins (user_id, check_date, encrypted_payload)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id, check_date)
       DO UPDATE SET encrypted_payload = excluded.encrypted_payload`,
      [userId, date, encrypted]
    );
    return serializeCheckin(
      db.get('SELECT * FROM emotional_checkins WHERE user_id = ? AND check_date = ?', [
        userId,
        date
      ])
    );
  }

  // Correlaciona humor/energia com a produtividade real numa janela.
  function map(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const janelaDias = Math.max(1, Math.min(180, Number(input.window_days) || 14));
    const hoje = dataDeHoje();
    const inicio = subtrairDias(hoje, janelaDias);

    const checkins = db
      .all(
        `SELECT id, user_id, check_date, encrypted_payload, created_at FROM emotional_checkins
        WHERE user_id = ? AND check_date BETWEEN ? AND ?
        ORDER BY check_date ASC`,
        [userId, inicio, hoje]
      )
      .map(serializeCheckin);

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

  function purge(userId) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const result = db.run('DELETE FROM emotional_checkins WHERE user_id = ?', [userId]);
    return { deleted: Number(result.changes) || 0 };
  }

  function anonymousSummary() {
    const aggregate = db.get(
      `SELECT COUNT(*) AS checkins,
              COUNT(DISTINCT user_id) AS users,
              MIN(check_date) AS first_date,
              MAX(check_date) AS last_date
         FROM emotional_checkins`
    );
    const users = Number(aggregate?.users) || 0;
    return {
      privacy_threshold_met: users >= 3,
      users: users >= 3 ? users : null,
      checkins: users >= 3 ? Number(aggregate?.checkins) || 0 : null,
      first_date: users >= 3 ? (aggregate?.first_date ?? null) : null,
      last_date: users >= 3 ? (aggregate?.last_date ?? null) : null,
      message:
        users >= 3
          ? 'Agregado anônimo calculado sem descriptografar check-ins individuais.'
          : 'São necessários ao menos 3 usuários para exibir um agregado anônimo.'
    };
  }

  return { record, map, purge, anonymousSummary };
}
