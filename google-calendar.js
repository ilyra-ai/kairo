// ============================================================================
//  Kairo — Módulo de Integração Real com o Google Calendar (OAuth 2.0)
//  Responsável por: autenticação OAuth, persistência de tokens no SQLite,
//  e sincronização bidirecional sob demanda (app ↔ Google Agenda).
//
//  Requisitos de configuração (arquivo .env na raiz do projeto):
//    GOOGLE_CLIENT_ID        = <seu Client ID do Google Cloud Console>
//    GOOGLE_CLIENT_SECRET    = <seu Client Secret>
//    GOOGLE_REDIRECT_URI     = http://localhost:3000/api/google/callback
//    GOOGLE_CALENDAR_ID      = primary            (opcional)
//    GOOGLE_CALENDAR_TIMEZONE= America/Sao_Paulo  (opcional)
// ============================================================================

import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const DEFAULT_TZ = process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/Sao_Paulo';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
export function isConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// ---------------------------------------------------------------------------
// Persistência de tokens (linha única id = 1)
// ---------------------------------------------------------------------------
async function loadTokens(db) {
  return db.get('SELECT * FROM google_tokens WHERE id = 1');
}

async function saveTokens(db, tokens, connectedEmail) {
  const existing = await loadTokens(db);
  // O Google só devolve refresh_token na 1ª autorização; preservamos o anterior.
  const refresh = tokens.refresh_token || (existing ? existing.refresh_token : null);

  if (existing) {
    await db.run(
      `UPDATE google_tokens
         SET access_token = ?, refresh_token = ?, scope = ?, token_type = ?,
             expiry_date = ?, connected_email = COALESCE(?, connected_email),
             updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [tokens.access_token, refresh, tokens.scope, tokens.token_type,
       tokens.expiry_date, connectedEmail || null]
    );
  } else {
    await db.run(
      `INSERT INTO google_tokens
         (id, access_token, refresh_token, scope, token_type, expiry_date, calendar_id, connected_email)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      [tokens.access_token, refresh, tokens.scope, tokens.token_type,
       tokens.expiry_date, CALENDAR_ID, connectedEmail || null]
    );
  }
}

// ---------------------------------------------------------------------------
// Fluxo OAuth
// ---------------------------------------------------------------------------
export function getAuthUrl() {
  const oauth2 = createOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: 'offline',      // garante refresh_token
    prompt: 'consent',           // força consentimento p/ obter refresh_token
    scope: SCOPES
  });
}

export async function handleCallback(db, code) {
  const oauth2 = createOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  // Descobre o e-mail conectado (informativo)
  let email = null;
  try {
    const oauth2api = google.oauth2({ version: 'v2', auth: oauth2 });
    const me = await oauth2api.userinfo.get();
    email = me.data.email || null;
  } catch (_) { /* opcional */ }

  await saveTokens(db, tokens, email);
  return { email };
}

// Retorna um cliente OAuth já autenticado (com refresh automático persistido)
async function getAuthedClient(db) {
  const saved = await loadTokens(db);
  if (!saved || !saved.refresh_token) return null;

  const oauth2 = createOAuthClient();
  oauth2.setCredentials({
    access_token: saved.access_token,
    refresh_token: saved.refresh_token,
    scope: saved.scope,
    token_type: saved.token_type,
    expiry_date: saved.expiry_date
  });

  // Persiste automaticamente tokens renovados
  oauth2.on('tokens', async (t) => {
    try { await saveTokens(db, t, saved.connected_email); } catch (_) {}
  });

  return oauth2;
}

export async function getStatus(db) {
  const saved = await loadTokens(db);
  return {
    configured: isConfigured(),
    connected: Boolean(saved && saved.refresh_token),
    email: saved ? saved.connected_email : null,
    calendarId: saved ? saved.calendar_id : CALENDAR_ID,
    lastSync: saved ? saved.updated_at : null
  };
}

export async function disconnect(db) {
  await db.run('DELETE FROM google_tokens WHERE id = 1');
  // Desvincula mapeamentos locais (mantém os eventos no app)
  await db.run('UPDATE agenda_events SET google_event_id = NULL, google_synced_at = NULL');
}

// ---------------------------------------------------------------------------
// Conversão de dados app → Google
// ---------------------------------------------------------------------------
function toGoogleEvent(ev) {
  // event_date = YYYY-MM-DD | start_time/end_time = HH:MM
  const startDateTime = `${ev.event_date}T${ev.start_time}:00`;
  const endDateTime = `${ev.event_date}T${ev.end_time}:00`;
  return {
    summary: ev.title,
    description: ev.description || '',
    start: { dateTime: startDateTime, timeZone: DEFAULT_TZ },
    end: { dateTime: endDateTime, timeZone: DEFAULT_TZ },
    // Guarda metadados do Kairo para reconhecimento na volta
    extendedProperties: {
      private: {
        kairo_activity_id: String(ev.activity_id),
        kairo_priority: ev.priority || 'media',
        kairo_cognitive_load: String(ev.cognitive_load || 1)
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Operações unitárias (chamadas pelas rotas de CRUD do server.js)
// ---------------------------------------------------------------------------
export async function pushEvent(db, ev) {
  const auth = await getAuthedClient(db);
  if (!auth) return null;
  const calendar = google.calendar({ version: 'v3', auth });
  const body = toGoogleEvent(ev);

  let googleId = ev.google_event_id;
  if (googleId) {
    // Atualiza remoto existente
    try {
      const res = await calendar.events.update({
        calendarId: CALENDAR_ID, eventId: googleId, requestBody: body
      });
      googleId = res.data.id;
    } catch (e) {
      if (e.code === 404) {
        const res = await calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: body });
        googleId = res.data.id;
      } else { throw e; }
    }
  } else {
    const res = await calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: body });
    googleId = res.data.id;
  }

  await db.run(
    'UPDATE agenda_events SET google_event_id = ?, google_synced_at = CURRENT_TIMESTAMP WHERE id = ?',
    [googleId, ev.id]
  );
  return googleId;
}

export async function deleteEvent(db, googleEventId) {
  if (!googleEventId) return;
  const auth = await getAuthedClient(db);
  if (!auth) return;
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: googleEventId });
  } catch (e) {
    if (e.code !== 404 && e.code !== 410) throw e; // já removido remotamente: ok
  }
}

// ---------------------------------------------------------------------------
// Sincronização bidirecional sob demanda
//   Retorna { pushed, pulled, updated, deleted }
// ---------------------------------------------------------------------------
export async function syncNow(db, helpers) {
  const auth = await getAuthedClient(db);
  if (!auth) throw new Error('Conta Google não conectada.');
  const calendar = google.calendar({ version: 'v3', auth });

  const stats = { pushed: 0, pulled: 0, updated: 0, deleted: 0 };

  // 1) PUSH: envia ao Google os eventos locais ainda não mapeados
  const unsynced = await db.all('SELECT * FROM agenda_events WHERE google_event_id IS NULL');
  for (const ev of unsynced) {
    await pushEvent(db, ev);
    stats.pushed++;
  }

  // 2) PULL: traz do Google os eventos (janela de -30 a +180 dias)
  const timeMin = new Date(); timeMin.setDate(timeMin.getDate() - 30);
  const timeMax = new Date(); timeMax.setDate(timeMax.getDate() + 180);

  let pageToken = null;
  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken: pageToken || undefined
    });

    for (const g of (res.data.items || [])) {
      if (g.status === 'cancelled') continue;
      if (!g.start || !g.start.dateTime) continue; // ignora eventos de dia inteiro

      const existing = await db.get('SELECT * FROM agenda_events WHERE google_event_id = ?', [g.id]);
      const parsed = parseGoogleEvent(g, helpers);

      if (existing) {
        // Atualiza local a partir do remoto
        await db.run(
          `UPDATE agenda_events
             SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?,
                 duration_hours = ?, google_synced_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [parsed.title, parsed.description, parsed.event_date, parsed.start_time,
           parsed.end_time, parsed.duration_hours, existing.id]
        );
        stats.updated++;
      } else {
        // Cria local vinculado a uma atividade (padrão: primeira atividade)
        const activityId = await helpers.resolveActivityId(g);
        const result = await db.run(
          `INSERT INTO agenda_events
             (activity_id, title, description, event_date, start_time, end_time,
              duration_hours, is_completed, priority, cognitive_load, event_color,
              google_event_id, google_synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'media', 1, NULL, ?, CURRENT_TIMESTAMP)`,
          [activityId, parsed.title, parsed.description, parsed.event_date,
           parsed.start_time, parsed.end_time, parsed.duration_hours, g.id]
        );
        if (result.lastID) stats.pulled++;
      }
      await helpers.syncTimeframesForActivity(
        existing ? existing.activity_id : await helpers.resolveActivityId(g)
      );
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  await db.run('UPDATE google_tokens SET updated_at = CURRENT_TIMESTAMP WHERE id = 1');
  return stats;
}

// Converte um evento do Google para o formato do Kairo
function parseGoogleEvent(g, helpers) {
  const start = new Date(g.start.dateTime);
  const end = new Date(g.end.dateTime);
  const pad = (n) => String(n).padStart(2, '0');
  const event_date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const start_time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const end_time = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  const duration_hours = helpers.calculateDuration(start_time, end_time);
  return {
    title: g.summary || '(Sem título)',
    description: g.description || '',
    event_date, start_time, end_time, duration_hours
  };
}
