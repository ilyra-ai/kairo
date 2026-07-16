// ============================================================================
// Kairo — Integração Google Agenda isolada por usuário e criptografada
// ============================================================================

import { createHash, randomBytes } from 'node:crypto';
import { google as defaultGoogleClient } from 'googleapis';
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
  normalizeEncryptionKey
} from '../../../security/crypto.js';
import {
  HttpError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unprocessable
} from '../../../shared/http-error.js';

const GOOGLE_SCOPES = Object.freeze([
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar'
]);
const STATE_BYTES = 32;
const STATE_TTL_MS = 10 * 60 * 1_000;
const USED_STATE_RETENTION_MS = 24 * 60 * 60 * 1_000;
const TOKEN_FIELDS = Object.freeze([
  'access_token',
  'refresh_token',
  'scope',
  'token_type',
  'expiry_date',
  'sync_token'
]);

function googleHttpError(status, code, message, cause, expose = true) {
  return new HttpError(status, code, message, { cause, expose });
}

function providerStatus(error) {
  const value = Number(error?.response?.status ?? error?.status ?? error?.code);
  return Number.isInteger(value) ? value : null;
}

function providerFailure(message, cause) {
  return googleHttpError(502, 'GOOGLE_API_INDISPONIVEL', message, cause);
}

function corruptedCredentials(cause) {
  return googleHttpError(
    500,
    'GOOGLE_CREDENCIAIS_CORROMPIDAS',
    'As credenciais locais do Google não puderam ser lidas com segurança.',
    cause,
    false
  );
}

function normalizePositiveId(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw unprocessable(
      `${label} precisa ser um número inteiro positivo.`,
      'IDENTIFICADOR_INVALIDO'
    );
  }
  return normalized;
}

function normalizeSessionId(value) {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw forbidden(
      'A sessão atual não pode iniciar a conexão com o Google.',
      'SESSAO_OAUTH_INVALIDA'
    );
  }
  return value;
}

function tokenAad(userId) {
  return `kairo:google-calendar:usuario:${userId}:credenciais:v1`;
}

function hashState(state) {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

function currentDate(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('O relógio da integração Google retornou uma data inválida.');
  }
  return value;
}

function tableColumns(db, tableName) {
  return new Set(db.all(`PRAGMA table_info("${tableName}")`).map((column) => column.name));
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeTokenPayload(value = {}) {
  const expiry = Number(value.expiry_date);
  return {
    access_token: normalizeOptionalString(value.access_token),
    refresh_token: normalizeOptionalString(value.refresh_token),
    scope: normalizeOptionalString(value.scope),
    token_type: normalizeOptionalString(value.token_type),
    expiry_date: Number.isFinite(expiry) && expiry > 0 ? expiry : null,
    sync_token: normalizeOptionalString(value.sync_token)
  };
}

function hasAnyCredential(tokens) {
  return Boolean(tokens?.access_token || tokens?.refresh_token);
}

function encryptTokens(tokens, userId, encryptionKey) {
  return encryptSensitiveValue(JSON.stringify(normalizeTokenPayload(tokens)), {
    aad: tokenAad(userId),
    key: encryptionKey
  });
}

function decryptTokens(payload, userId, encryptionKey) {
  try {
    const plaintext = decryptSensitiveValue(payload, {
      aad: tokenAad(userId),
      key: encryptionKey
    });
    const parsed = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('O envelope não contém um objeto de credenciais.');
    }
    return normalizeTokenPayload(parsed);
  } catch (error) {
    throw corruptedCredentials(error);
  }
}

function migratePlaintextCredentials(db, encryptionKey) {
  const rows = db.all(`
    SELECT id, user_id, encrypted_payload, access_token, refresh_token,
           scope, token_type, expiry_date, sync_token
    FROM google_tokens
    WHERE encrypted_payload IS NOT NULL
       OR access_token IS NOT NULL
       OR refresh_token IS NOT NULL
       OR scope IS NOT NULL
       OR token_type IS NOT NULL
       OR expiry_date IS NOT NULL
       OR sync_token IS NOT NULL
    ORDER BY user_id
  `);

  return db.transaction((transactionDb) => {
    let migrated = 0;
    let scrubbed = 0;

    for (const row of rows) {
      const userId = normalizePositiveId(
        row.user_id,
        'O identificador do proprietário das credenciais'
      );
      let encryptedPayload = row.encrypted_payload;
      const hasPlaintext = TOKEN_FIELDS.some(
        (field) => row[field] !== null && row[field] !== undefined
      );

      if (encryptedPayload) {
        decryptTokens(encryptedPayload, userId, encryptionKey);
      } else {
        encryptedPayload = encryptTokens(row, userId, encryptionKey);
        migrated += 1;
      }

      if (!hasPlaintext) continue;
      transactionDb.run(
        `UPDATE google_tokens
         SET encrypted_payload = ?, access_token = NULL, refresh_token = NULL,
             scope = NULL, token_type = NULL, expiry_date = NULL, sync_token = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [encryptedPayload, row.id, userId]
      );
      if (hasPlaintext) scrubbed += 1;
    }

    return { migrated, scrubbed };
  });
}

/**
 * Evolui apenas a superfície da integração. A migração tenant principal cria
 * `google_tokens`; esta etapa acrescenta o envelope e o estado OAuth de uso único.
 */
export function ensureGoogleCalendarSchema(db, encryptionKey) {
  if (!db) throw new Error('O banco é obrigatório para preparar a integração Google.');
  const key = normalizeEncryptionKey(encryptionKey);

  db.exec(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      access_token TEXT DEFAULT NULL,
      refresh_token TEXT DEFAULT NULL,
      scope TEXT DEFAULT NULL,
      token_type TEXT DEFAULT NULL,
      expiry_date INTEGER DEFAULT NULL,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      sync_token TEXT DEFAULT NULL,
      connected_email TEXT DEFAULT NULL,
      encrypted_payload TEXT DEFAULT NULL,
      last_synced_at DATETIME DEFAULT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);

  const tokenColumns = tableColumns(db, 'google_tokens');
  if (!tokenColumns.has('encrypted_payload')) {
    db.exec('ALTER TABLE google_tokens ADD COLUMN encrypted_payload TEXT DEFAULT NULL;');
  }
  if (!tokenColumns.has('last_synced_at')) {
    db.exec('ALTER TABLE google_tokens ADD COLUMN last_synced_at DATETIME DEFAULT NULL;');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY CHECK (length(state_hash) = 64),
      user_id INTEGER NOT NULL,
      session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 8 AND 128),
      expires_at DATETIME NOT NULL,
      used_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_states_expiration
      ON oauth_states (expires_at, used_at);
    CREATE INDEX IF NOT EXISTS idx_oauth_states_user_session
      ON oauth_states (user_id, session_id);
  `);

  return migratePlaintextCredentials(db, key);
}

function clipText(value, maximum, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const source = normalized || fallback;
  return Array.from(source).slice(0, maximum).join('');
}

function calculateDurationHours(start, end) {
  const milliseconds = end.getTime() - start.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  return milliseconds / 3_600_000;
}

function makeDateTimeFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
  } catch (error) {
    throw new TypeError(`O fuso horário do Google Agenda é inválido: ${timeZone}`, {
      cause: error
    });
  }
}

function formattedDateTime(formatter, date) {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

export function createGoogleCalendarService(options = {}) {
  const {
    db,
    config = {},
    encryptionKey,
    googleClient = defaultGoogleClient,
    agendaService = null,
    logger = console,
    now = () => new Date(),
    stateTtlMs = STATE_TTL_MS
  } = options;

  if (!db) throw new Error('O banco é obrigatório para o serviço do Google Agenda.');
  if (!googleClient?.auth?.OAuth2 || typeof googleClient.calendar !== 'function') {
    throw new TypeError('O cliente Google injetado não implementa as APIs OAuth2 e Calendar.');
  }
  if (!Number.isSafeInteger(stateTtlMs) || stateTtlMs < 60_000 || stateTtlMs > 30 * 60_000) {
    throw new TypeError('A validade do estado OAuth precisa ficar entre 1 e 30 minutos.');
  }

  const key = normalizeEncryptionKey(encryptionKey);
  const calendarId = String(config.calendarId || 'primary').trim();
  const timeZone = String(config.timezone || 'America/Sao_Paulo').trim();
  if (!calendarId)
    throw new TypeError('O identificador do calendário Google não pode ficar vazio.');
  const dateTimeFormatter = makeDateTimeFormatter(timeZone);
  ensureGoogleCalendarSchema(db, key);

  function isConfigured() {
    return Boolean(config.clientId && config.clientSecret && config.redirectUri);
  }

  function requireConfiguration() {
    if (!isConfigured()) {
      throw googleHttpError(
        503,
        'GOOGLE_NAO_CONFIGURADO',
        'A integração com o Google Agenda ainda não foi configurada pelo administrador.'
      );
    }
  }

  function createOAuthClient() {
    requireConfiguration();
    return new googleClient.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
  }

  function connectionRow(userId) {
    return db.get(
      `SELECT id, user_id, calendar_id, connected_email, encrypted_payload,
              last_synced_at, updated_at
       FROM google_tokens
       WHERE user_id = ?`,
      [userId]
    );
  }

  function loadTokens(userId) {
    const row = connectionRow(userId);
    if (!row?.encrypted_payload) return { row, tokens: null };
    return { row, tokens: decryptTokens(row.encrypted_payload, userId, key) };
  }

  function saveTokens(userId, receivedTokens, connectedEmail = null) {
    const current = loadTokens(userId);
    const incoming = normalizeTokenPayload(receivedTokens);
    const merged = {};
    for (const field of TOKEN_FIELDS) {
      merged[field] = incoming[field] ?? current.tokens?.[field] ?? null;
    }
    if (!hasAnyCredential(merged)) {
      throw conflict(
        'O Google não retornou credenciais utilizáveis. Reconecte a conta e conceda o acesso solicitado.',
        'GOOGLE_CREDENCIAIS_AUSENTES'
      );
    }

    const payload = encryptTokens(merged, userId, key);
    db.run(
      `INSERT INTO google_tokens
         (user_id, calendar_id, connected_email, encrypted_payload,
          access_token, refresh_token, scope, token_type, expiry_date, sync_token, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         calendar_id = excluded.calendar_id,
         connected_email = COALESCE(excluded.connected_email, google_tokens.connected_email),
         encrypted_payload = excluded.encrypted_payload,
         access_token = NULL,
         refresh_token = NULL,
         scope = NULL,
         token_type = NULL,
         expiry_date = NULL,
         sync_token = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, current.row?.calendar_id || calendarId, connectedEmail, payload]
    );
    return merged;
  }

  function attachRefreshPersistence(oauthClient, userId) {
    if (typeof oauthClient.on !== 'function') return;
    oauthClient.on('tokens', (tokens) => {
      saveTokens(userId, tokens);
    });
  }

  function getAuthedConnection(userId, { optional = false } = {}) {
    if (!isConfigured()) {
      if (optional) return null;
      requireConfiguration();
    }
    const saved = loadTokens(userId);
    if (!saved.tokens || !hasAnyCredential(saved.tokens)) {
      if (optional) return null;
      throw conflict(
        'Conecte sua conta Google antes de sincronizar a agenda.',
        'GOOGLE_NAO_CONECTADO'
      );
    }

    const oauthClient = createOAuthClient();
    oauthClient.setCredentials({
      access_token: saved.tokens.access_token || undefined,
      refresh_token: saved.tokens.refresh_token || undefined,
      scope: saved.tokens.scope || undefined,
      token_type: saved.tokens.token_type || undefined,
      expiry_date: saved.tokens.expiry_date || undefined
    });
    attachRefreshPersistence(oauthClient, userId);
    return {
      auth: oauthClient,
      calendarId: saved.row.calendar_id || calendarId,
      row: saved.row,
      tokens: saved.tokens
    };
  }

  function cleanupOauthStates(referenceDate) {
    const nowIso = referenceDate.toISOString();
    const usedBefore = new Date(referenceDate.getTime() - USED_STATE_RETENTION_MS).toISOString();
    db.run(
      `DELETE FROM oauth_states
       WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at <= ?)`,
      [nowIso, usedBefore]
    );
  }

  function createAuthorization(userIdValue, sessionIdValue) {
    requireConfiguration();
    const userId = normalizePositiveId(userIdValue, 'O identificador do usuário');
    const sessionId = normalizeSessionId(sessionIdValue);
    const referenceDate = currentDate(now);
    cleanupOauthStates(referenceDate);

    const state = randomBytes(STATE_BYTES).toString('base64url');
    const stateHash = hashState(state);
    const expiresAt = new Date(referenceDate.getTime() + stateTtlMs).toISOString();
    db.run(
      `INSERT INTO oauth_states
         (state_hash, user_id, session_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [stateHash, userId, sessionId, expiresAt, referenceDate.toISOString()]
    );

    try {
      const auth = createOAuthClient();
      const url = auth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        scope: GOOGLE_SCOPES,
        state
      });
      return { url, expiresAt };
    } catch (error) {
      db.run('DELETE FROM oauth_states WHERE state_hash = ?', [stateHash]);
      throw providerFailure('Não foi possível iniciar a autorização com o Google.', error);
    }
  }

  function consumeOauthState(userId, sessionId, state) {
    const referenceDate = currentDate(now);
    const result = db.run(
      `UPDATE oauth_states
       SET used_at = ?
       WHERE state_hash = ?
         AND user_id = ?
         AND session_id = ?
         AND used_at IS NULL
         AND expires_at > ?`,
      [
        referenceDate.toISOString(),
        hashState(state),
        userId,
        sessionId,
        referenceDate.toISOString()
      ]
    );
    if (result.changes !== 1) {
      throw forbidden(
        'A autorização do Google expirou, já foi usada ou não pertence a esta sessão.',
        'GOOGLE_OAUTH_STATE_INVALIDO'
      );
    }
  }

  async function connectedEmail(oauthClient) {
    if (typeof googleClient.oauth2 !== 'function') return null;
    try {
      const userInfo = googleClient.oauth2({ version: 'v2', auth: oauthClient });
      const response = await userInfo.userinfo.get();
      return normalizeOptionalString(response?.data?.email);
    } catch (error) {
      logger.warn?.({
        evento: 'google_email_indisponivel',
        statusGoogle: providerStatus(error)
      });
      return null;
    }
  }

  async function handleCallback(userIdValue, sessionIdValue, input) {
    requireConfiguration();
    const userId = normalizePositiveId(userIdValue, 'O identificador do usuário');
    const sessionId = normalizeSessionId(sessionIdValue);
    consumeOauthState(userId, sessionId, input.state);

    if (input.error) {
      throw badRequest(
        'A autorização do Google foi cancelada ou recusada.',
        'GOOGLE_AUTORIZACAO_RECUSADA'
      );
    }
    if (!input.code) {
      throw badRequest(
        'O Google não retornou o código necessário para concluir a conexão.',
        'GOOGLE_CODIGO_AUSENTE'
      );
    }

    const oauthClient = createOAuthClient();
    let tokens;
    try {
      const response = await oauthClient.getToken(input.code);
      tokens = response?.tokens;
    } catch (error) {
      throw providerFailure('O Google não aceitou o código de autorização informado.', error);
    }
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
      throw providerFailure('O Google retornou uma resposta de credenciais inválida.');
    }

    const previousTokens = loadTokens(userId).tokens;
    if (!tokens?.refresh_token && !previousTokens?.refresh_token) {
      throw providerFailure(
        'O Google não forneceu uma credencial de renovação. Remova o acesso antigo na sua conta Google e conecte novamente.'
      );
    }

    oauthClient.setCredentials(tokens);
    saveTokens(userId, tokens);
    attachRefreshPersistence(oauthClient, userId);
    const email = await connectedEmail(oauthClient);
    if (email) saveTokens(userId, {}, email);

    return { email, calendarId: connectionRow(userId)?.calendar_id || calendarId };
  }

  function getStatus(userIdValue) {
    const userId = normalizePositiveId(userIdValue, 'O identificador do usuário');
    const saved = loadTokens(userId);
    const configured = isConfigured();
    return {
      configured,
      connected: configured && Boolean(saved.tokens?.refresh_token),
      email: saved.row?.connected_email || null,
      calendarId: saved.row?.calendar_id || calendarId,
      lastSync: saved.row?.last_synced_at || null
    };
  }

  function ownEvent(userId, eventId) {
    const event = db.get(
      `SELECT agenda_events.*
       FROM agenda_events
       WHERE agenda_events.id = ? AND agenda_events.user_id = ?`,
      [eventId, userId]
    );
    if (!event) {
      throw notFound('Compromisso não encontrado.', 'COMPROMISSO_NAO_ENCONTRADO');
    }
    return event;
  }

  function toGoogleEvent(event) {
    return {
      summary: event.title,
      description: event.description || '',
      start: {
        dateTime: `${event.event_date}T${event.start_time}:00`,
        timeZone
      },
      end: {
        dateTime: `${event.event_date}T${event.end_time}:00`,
        timeZone
      },
      extendedProperties: {
        private: {
          kairo_activity_id: String(event.activity_id),
          kairo_priority: event.priority || 'media',
          kairo_cognitive_load: String(event.cognitive_load || 1)
        }
      }
    };
  }

  async function pushOwnedEvent(userId, event, connection, calendar) {
    let googleEventId = event.google_event_id;
    const requestBody = toGoogleEvent(event);

    try {
      if (googleEventId) {
        try {
          const response = await calendar.events.update({
            calendarId: connection.calendarId,
            eventId: googleEventId,
            requestBody
          });
          googleEventId = response?.data?.id || googleEventId;
        } catch (error) {
          if (providerStatus(error) !== 404) throw error;
          const response = await calendar.events.insert({
            calendarId: connection.calendarId,
            requestBody
          });
          googleEventId = response?.data?.id;
        }
      } else {
        const response = await calendar.events.insert({
          calendarId: connection.calendarId,
          requestBody
        });
        googleEventId = response?.data?.id;
      }
    } catch (error) {
      throw providerFailure('Não foi possível enviar o compromisso ao Google Agenda.', error);
    }

    if (!googleEventId) {
      throw providerFailure('O Google não retornou o identificador do compromisso sincronizado.');
    }
    const updated = db.run(
      `UPDATE agenda_events
       SET google_event_id = ?, google_synced_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [googleEventId, event.id, userId]
    );
    if (updated.changes !== 1) {
      throw notFound('Compromisso não encontrado.', 'COMPROMISSO_NAO_ENCONTRADO');
    }
    return googleEventId;
  }

  async function pushEvent(userIdValue, eventIdValue) {
    const userId = normalizePositiveId(userIdValue, 'O identificador do usuário');
    const eventId = normalizePositiveId(eventIdValue, 'O identificador do compromisso');
    const event = ownEvent(userId, eventId);
    const connection = getAuthedConnection(userId, { optional: true });
    if (!connection) return null;
    const calendar = googleClient.calendar({ version: 'v3', auth: connection.auth });
    return pushOwnedEvent(userId, event, connection, calendar);
  }

  async function deleteEvent(userIdValue, eventIdValue) {
    const userId = normalizePositiveId(userIdValue, 'O identificador do usuário');
    const eventId = normalizePositiveId(eventIdValue, 'O identificador do compromisso');
    const event = ownEvent(userId, eventId);
    if (!event.google_event_id) return false;

    const connection = getAuthedConnection(userId, { optional: true });
    if (!connection) return false;
    const calendar = googleClient.calendar({ version: 'v3', auth: connection.auth });
    try {
      await calendar.events.delete({
        calendarId: connection.calendarId,
        eventId: event.google_event_id
      });
    } catch (error) {
      if (![404, 410].includes(providerStatus(error))) {
        throw providerFailure('Não foi possível remover o compromisso do Google Agenda.', error);
      }
    }

    db.run(
      `UPDATE agenda_events
       SET google_event_id = NULL, google_synced_at = NULL
       WHERE id = ? AND user_id = ?`,
      [eventId, userId]
    );
    return true;
  }

  function parseGoogleEvent(event) {
    const start = new Date(event?.start?.dateTime);
    const end = new Date(event?.end?.dateTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const durationHours = calculateDurationHours(start, end);
    if (durationHours === null) return null;
    const localStart = formattedDateTime(dateTimeFormatter, start);
    const localEnd = formattedDateTime(dateTimeFormatter, end);
    if (localStart.date !== localEnd.date) return null;

    const priority = ['baixa', 'media', 'alta'].includes(
      event?.extendedProperties?.private?.kairo_priority
    )
      ? event.extendedProperties.private.kairo_priority
      : 'media';
    const cognitiveCandidate = Number(event?.extendedProperties?.private?.kairo_cognitive_load);
    const cognitiveLoad =
      Number.isInteger(cognitiveCandidate) && cognitiveCandidate >= 1 && cognitiveCandidate <= 3
        ? cognitiveCandidate
        : 1;

    return {
      title: clipText(event.summary, 200, '(Sem título)'),
      description: clipText(event.description, 4_000),
      event_date: localStart.date,
      start_time: localStart.time,
      end_time: localEnd.time,
      duration_hours: durationHours,
      priority,
      cognitive_load: cognitiveLoad
    };
  }

  function resolveOwnedActivity(userId, event, currentActivityId = null) {
    const requested = Number(event?.extendedProperties?.private?.kairo_activity_id);
    const candidates = [requested, Number(currentActivityId)].filter(
      (value) => Number.isSafeInteger(value) && value > 0
    );
    for (const activityId of candidates) {
      const owned = db.get('SELECT id FROM activities WHERE id = ? AND user_id = ?', [
        activityId,
        userId
      ]);
      if (owned) return Number(owned.id);
    }

    const fallback = db.get('SELECT id FROM activities WHERE user_id = ? ORDER BY id LIMIT 1', [
      userId
    ]);
    if (!fallback) {
      throw conflict(
        'Crie ao menos uma atividade antes de importar compromissos do Google.',
        'ATIVIDADE_NECESSARIA'
      );
    }
    return Number(fallback.id);
  }

  function recalculateActivities(userId, activityIds) {
    if (typeof agendaService?.recalculateTimeframes !== 'function') return;
    for (const activityId of activityIds) {
      agendaService.recalculateTimeframes(userId, activityId);
    }
  }

  async function syncNow(userIdValue, window = {}) {
    const userId = normalizePositiveId(userIdValue, 'O identificador do usuário');
    const daysBefore = Number(window.daysBefore ?? 30);
    const daysAfter = Number(window.daysAfter ?? 180);
    if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 365) {
      throw unprocessable(
        'A janela anterior precisa ser um número inteiro entre 0 e 365 dias.',
        'GOOGLE_JANELA_INVALIDA'
      );
    }
    if (!Number.isInteger(daysAfter) || daysAfter < 1 || daysAfter > 730) {
      throw unprocessable(
        'A janela futura precisa ser um número inteiro entre 1 e 730 dias.',
        'GOOGLE_JANELA_INVALIDA'
      );
    }
    const connection = getAuthedConnection(userId);
    const calendar = googleClient.calendar({ version: 'v3', auth: connection.auth });
    const stats = { pushed: 0, pulled: 0, updated: 0, deleted: 0, ignored: 0 };
    const affectedActivities = new Set();

    const unsynced = db.all(
      `SELECT agenda_events.*
       FROM agenda_events
       WHERE agenda_events.user_id = ? AND agenda_events.google_event_id IS NULL
       ORDER BY agenda_events.id`,
      [userId]
    );
    for (const event of unsynced) {
      await pushOwnedEvent(userId, event, connection, calendar);
      stats.pushed += 1;
    }

    const referenceDate = currentDate(now);
    const timeMin = new Date(referenceDate);
    const timeMax = new Date(referenceDate);
    timeMin.setUTCDate(timeMin.getUTCDate() - daysBefore);
    timeMax.setUTCDate(timeMax.getUTCDate() + daysAfter);

    let pageToken;
    do {
      let response;
      try {
        response = await calendar.events.list({
          calendarId: connection.calendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          showDeleted: true,
          maxResults: 250,
          pageToken
        });
      } catch (error) {
        throw providerFailure(
          'Não foi possível consultar os compromissos no Google Agenda.',
          error
        );
      }

      for (const remoteEvent of response?.data?.items || []) {
        if (!remoteEvent?.id) {
          stats.ignored += 1;
          continue;
        }
        const existing = db.get(
          `SELECT id, activity_id
           FROM agenda_events
           WHERE user_id = ? AND google_event_id = ?`,
          [userId, remoteEvent.id]
        );

        if (remoteEvent.status === 'cancelled') {
          if (existing) {
            db.run('DELETE FROM agenda_events WHERE id = ? AND user_id = ?', [existing.id, userId]);
            affectedActivities.add(Number(existing.activity_id));
            stats.deleted += 1;
          }
          continue;
        }

        const parsed = parseGoogleEvent(remoteEvent);
        if (!parsed) {
          stats.ignored += 1;
          continue;
        }
        const activityId = resolveOwnedActivity(userId, remoteEvent, existing?.activity_id);

        if (existing) {
          db.run(
            `UPDATE agenda_events
             SET activity_id = ?, title = ?, description = ?, event_date = ?,
                 start_time = ?, end_time = ?, duration_hours = ?, priority = ?,
                 cognitive_load = ?, google_synced_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ?`,
            [
              activityId,
              parsed.title,
              parsed.description,
              parsed.event_date,
              parsed.start_time,
              parsed.end_time,
              parsed.duration_hours,
              parsed.priority,
              parsed.cognitive_load,
              existing.id,
              userId
            ]
          );
          affectedActivities.add(Number(existing.activity_id));
          affectedActivities.add(activityId);
          stats.updated += 1;
        } else {
          db.run(
            `INSERT INTO agenda_events
               (user_id, activity_id, title, description, event_date, start_time,
                end_time, duration_hours, is_completed, priority, cognitive_load,
                event_color, google_event_id, google_synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, CURRENT_TIMESTAMP)`,
            [
              userId,
              activityId,
              parsed.title,
              parsed.description,
              parsed.event_date,
              parsed.start_time,
              parsed.end_time,
              parsed.duration_hours,
              parsed.priority,
              parsed.cognitive_load,
              remoteEvent.id
            ]
          );
          affectedActivities.add(activityId);
          stats.pulled += 1;
        }
      }
      pageToken = response?.data?.nextPageToken || undefined;
    } while (pageToken);

    recalculateActivities(userId, affectedActivities);
    db.run(
      `UPDATE google_tokens
       SET last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [userId]
    );
    return stats;
  }

  async function disconnect(userIdValue) {
    const userId = normalizePositiveId(userIdValue, 'O identificador do usuário');
    const saved = loadTokens(userId);
    const connection = hasAnyCredential(saved.tokens) ? getAuthedConnection(userId) : null;

    if (connection) {
      const tokenToRevoke = connection.tokens.refresh_token || connection.tokens.access_token;
      try {
        if (tokenToRevoke && typeof connection.auth.revokeToken === 'function') {
          await connection.auth.revokeToken(tokenToRevoke);
        } else if (typeof connection.auth.revokeCredentials === 'function') {
          await connection.auth.revokeCredentials();
        } else {
          throw new TypeError('O cliente OAuth não oferece uma operação de revogação.');
        }
      } catch (error) {
        if (![400, 401].includes(providerStatus(error))) {
          throw providerFailure(
            'O Google não confirmou a revogação. A conexão local foi preservada para uma nova tentativa segura.',
            error
          );
        }
      }
    }

    db.transaction((transactionDb) => {
      transactionDb.run('DELETE FROM oauth_states WHERE user_id = ?', [userId]);
      transactionDb.run('DELETE FROM google_tokens WHERE user_id = ?', [userId]);
      transactionDb.run(
        `UPDATE agenda_events
         SET google_event_id = NULL, google_synced_at = NULL
         WHERE user_id = ?`,
        [userId]
      );
    });
  }

  return {
    createAuthorization,
    deleteEvent,
    disconnect,
    getStatus,
    handleCallback,
    isConfigured,
    pushEvent,
    syncNow
  };
}

export { GOOGLE_SCOPES };
