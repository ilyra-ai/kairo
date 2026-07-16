// ============================================================================
// Kairo — Integração real do serviço Google Agenda em banco isolado
// ============================================================================

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { createCoreTables, openSqliteClient } from '../../src/server/database/index.js';
import { decryptSensitiveValue } from '../../src/server/security/crypto.js';
import { createGoogleCalendarService } from '../../src/server/modules/integrations/google-calendar/google-calendar.service.js';

const GOOGLE_CONFIG = Object.freeze({
  clientId: 'cliente-google-de-teste',
  clientSecret: 'segredo-google-de-teste',
  redirectUri: 'http://127.0.0.1:3000/api/google/callback',
  calendarId: 'primary',
  timezone: 'America/Sao_Paulo'
});

function createDatabase(t) {
  const db = openSqliteClient(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT 'hash-de-teste',
      role TEXT NOT NULL DEFAULT 'usuario',
      plan TEXT NOT NULL DEFAULT 'free',
      is_active INTEGER NOT NULL DEFAULT 1,
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, name, email) VALUES
      (1, 'Pessoa Um', 'pessoa.um@kairo.local'),
      (2, 'Pessoa Dois', 'pessoa.dois@kairo.local');
  `);
  createCoreTables(db);
  db.exec(`
    INSERT INTO activities (id, user_id, title) VALUES
      (11, 1, 'Atividade da pessoa um'),
      (22, 2, 'Atividade da pessoa dois');
  `);
  return db;
}

function insertToken(db, userId, suffix = String(userId)) {
  db.run(
    `INSERT INTO google_tokens
       (user_id, access_token, refresh_token, scope, token_type, expiry_date,
        calendar_id, connected_email)
     VALUES (?, ?, ?, ?, 'Bearer', ?, 'primary', ?)`,
    [
      userId,
      `acesso-${suffix}`,
      `renovacao-${suffix}`,
      'openid email https://www.googleapis.com/auth/calendar',
      Date.now() + 3_600_000,
      `pessoa.${suffix}@example.com`
    ]
  );
}

function insertEvent(db, { id, userId, activityId, title, googleEventId = null }) {
  db.run(
    `INSERT INTO agenda_events
       (id, user_id, activity_id, title, description, event_date, start_time,
        end_time, duration_hours, is_completed, priority, cognitive_load,
        google_event_id, google_synced_at)
     VALUES (?, ?, ?, ?, '', '2026-07-20', '09:00', '10:00', 1, 0,
             'media', 1, ?, CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)`,
    [id, userId, activityId, title, googleEventId, googleEventId]
  );
}

function createFakeGoogle(options = {}) {
  const calls = {
    authOptions: [],
    clients: [],
    deletes: [],
    getToken: [],
    inserts: [],
    lists: [],
    revoked: [],
    updates: []
  };
  let insertedSequence = 0;

  class FakeOAuth2 extends EventEmitter {
    constructor(clientId, clientSecret, redirectUri) {
      super();
      this.clientId = clientId;
      this.clientSecret = clientSecret;
      this.redirectUri = redirectUri;
      this.credentials = {};
      calls.clients.push(this);
    }

    generateAuthUrl(authOptions) {
      calls.authOptions.push(authOptions);
      const url = new URL('https://accounts.google.test/o/oauth2/v2/auth');
      url.searchParams.set('state', authOptions.state);
      return url.toString();
    }

    async getToken(code) {
      calls.getToken.push(code);
      if (options.getTokenError) throw options.getTokenError;
      return {
        tokens: options.callbackTokens || {
          access_token: 'acesso-do-callback',
          refresh_token: 'renovacao-do-callback',
          scope: 'openid email https://www.googleapis.com/auth/calendar',
          token_type: 'Bearer',
          expiry_date: Date.now() + 3_600_000
        }
      };
    }

    setCredentials(credentials) {
      this.credentials = { ...credentials };
    }

    async revokeToken(token) {
      calls.revoked.push(token);
      if (options.revokeError) throw options.revokeError;
      return { data: { success: true } };
    }
  }

  const googleClient = {
    auth: { OAuth2: FakeOAuth2 },
    oauth2() {
      return {
        userinfo: {
          async get() {
            if (options.userInfoError) throw options.userInfoError;
            return { data: { email: options.email || 'conectada@example.com' } };
          }
        }
      };
    },
    calendar({ auth }) {
      return {
        events: {
          async insert(parameters) {
            calls.inserts.push(parameters);
            insertedSequence += 1;
            return { data: { id: `google-inserido-${insertedSequence}` } };
          },
          async update(parameters) {
            calls.updates.push(parameters);
            if (options.updateError) throw options.updateError;
            return { data: { id: parameters.eventId } };
          },
          async delete(parameters) {
            calls.deletes.push(parameters);
            if (options.deleteError) throw options.deleteError;
            return { data: {} };
          },
          async list(parameters) {
            calls.lists.push(parameters);
            if (options.refreshedTokens) auth.emit('tokens', options.refreshedTokens);
            if (options.listError) throw options.listError;
            if (typeof options.listResponse === 'function') {
              return options.listResponse(parameters, calls.lists.length);
            }
            return { data: { items: options.remoteEvents || [] } };
          }
        }
      };
    }
  };

  return { calls, googleClient };
}

function decryptRow(row, userId, encryptionKey) {
  return JSON.parse(
    decryptSensitiveValue(row.encrypted_payload, {
      aad: `kairo:google-calendar:usuario:${userId}:credenciais:v1`,
      key: encryptionKey
    })
  );
}

describe('Google Agenda seguro por usuário', () => {
  it('migra todas as credenciais legadas para AES-256-GCM e zera cada coluna em texto puro', (t) => {
    const db = createDatabase(t);
    const encryptionKey = randomBytes(32);
    insertToken(db, 1, 'um');
    insertToken(db, 2, 'dois');
    const fake = createFakeGoogle();

    const service = createGoogleCalendarService({
      db,
      config: GOOGLE_CONFIG,
      encryptionKey,
      googleClient: fake.googleClient
    });

    const rows = db.all(`
      SELECT user_id, access_token, refresh_token, scope, token_type,
             expiry_date, sync_token, encrypted_payload
      FROM google_tokens
      ORDER BY user_id
    `);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.access_token, null);
      assert.equal(row.refresh_token, null);
      assert.equal(row.scope, null);
      assert.equal(row.token_type, null);
      assert.equal(row.expiry_date, null);
      assert.equal(row.sync_token, null);
      assert.match(row.encrypted_payload, /^kairo:v1:/);
    }
    assert.equal(decryptRow(rows[0], 1, encryptionKey).refresh_token, 'renovacao-um');
    assert.equal(decryptRow(rows[1], 2, encryptionKey).access_token, 'acesso-dois');
    assert.throws(
      () =>
        decryptSensitiveValue(rows[0].encrypted_payload, {
          aad: 'kairo:google-calendar:usuario:2:credenciais:v1',
          key: encryptionKey
        }),
      /integridade ou contexto inválido/
    );
    assert.equal(service.getStatus(1).connected, true);
    assert.equal(service.getStatus(2).email, 'pessoa.dois@example.com');
  });

  it('vincula state ao usuário e à sessão, valida antes do getToken e impede reutilização', async (t) => {
    const db = createDatabase(t);
    const encryptionKey = randomBytes(32);
    const fake = createFakeGoogle();
    let currentTime = new Date('2026-07-16T12:00:00.000Z');
    const service = createGoogleCalendarService({
      db,
      config: GOOGLE_CONFIG,
      encryptionKey,
      googleClient: fake.googleClient,
      now: () => new Date(currentTime)
    });

    const authorization = service.createAuthorization(1, 'sessao-usuario-1');
    const state = new URL(authorization.url).searchParams.get('state');
    assert.equal(state.length, 43);
    const persistedState = db.get('SELECT * FROM oauth_states');
    assert.notEqual(persistedState.state_hash, state);
    assert.equal(persistedState.user_id, 1);
    assert.equal(persistedState.session_id, 'sessao-usuario-1');
    assert.equal(fake.calls.authOptions[0].access_type, 'offline');
    assert.equal(fake.calls.authOptions[0].prompt, 'consent');

    await assert.rejects(
      service.handleCallback(1, 'sessao-incorreta', { state, code: 'codigo-valido' }),
      (error) => error.code === 'GOOGLE_OAUTH_STATE_INVALIDO'
    );
    assert.equal(fake.calls.getToken.length, 0, 'getToken não pode rodar antes de state válido');

    const result = await service.handleCallback(1, 'sessao-usuario-1', {
      state,
      code: 'codigo-valido'
    });
    assert.equal(result.email, 'conectada@example.com');
    assert.deepEqual(fake.calls.getToken, ['codigo-valido']);
    assert.ok(db.get('SELECT used_at FROM oauth_states').used_at);

    await assert.rejects(
      service.handleCallback(1, 'sessao-usuario-1', { state, code: 'codigo-repetido' }),
      (error) => error.code === 'GOOGLE_OAUTH_STATE_INVALIDO'
    );
    assert.deepEqual(fake.calls.getToken, ['codigo-valido']);

    const expiringAuthorization = service.createAuthorization(1, 'sessao-usuario-1');
    const expiringState = new URL(expiringAuthorization.url).searchParams.get('state');
    currentTime = new Date('2026-07-16T12:11:00.000Z');
    await assert.rejects(
      service.handleCallback(1, 'sessao-usuario-1', {
        state: expiringState,
        code: 'codigo-expirado'
      }),
      (error) => error.code === 'GOOGLE_OAUTH_STATE_INVALIDO'
    );
    assert.deepEqual(fake.calls.getToken, ['codigo-valido']);

    const stored = db.get('SELECT * FROM google_tokens WHERE user_id = 1');
    assert.equal(stored.access_token, null);
    assert.equal(stored.refresh_token, null);
    assert.equal(decryptRow(stored, 1, encryptionKey).refresh_token, 'renovacao-do-callback');
  });

  it('sincroniza apenas o tenant autenticado, preserva refresh token e rejeita activity_id alheio', async (t) => {
    const db = createDatabase(t);
    const encryptionKey = randomBytes(32);
    insertToken(db, 1, 'um');
    insertToken(db, 2, 'dois');
    insertEvent(db, {
      id: 101,
      userId: 1,
      activityId: 11,
      title: 'Enviar somente da pessoa um'
    });
    insertEvent(db, {
      id: 102,
      userId: 1,
      activityId: 11,
      title: 'Cancelar da pessoa um',
      googleEventId: 'google-cancelado'
    });
    insertEvent(db, {
      id: 201,
      userId: 2,
      activityId: 22,
      title: 'Nunca enviar da pessoa dois'
    });
    insertEvent(db, {
      id: 202,
      userId: 2,
      activityId: 22,
      title: 'Mapeamento da pessoa dois',
      googleEventId: 'google-cancelado'
    });

    const fake = createFakeGoogle({
      refreshedTokens: {
        access_token: 'acesso-renovado-da-pessoa-um',
        expiry_date: Date.now() + 7_200_000
      },
      remoteEvents: [
        {
          id: 'google-importado',
          status: 'confirmed',
          summary: 'Importado com atividade alheia',
          description: 'Deve cair somente na atividade da pessoa um.',
          start: { dateTime: '2026-07-21T14:00:00-03:00' },
          end: { dateTime: '2026-07-21T15:30:00-03:00' },
          extendedProperties: {
            private: { kairo_activity_id: '22', kairo_priority: 'alta', kairo_cognitive_load: '3' }
          }
        },
        { id: 'google-cancelado', status: 'cancelled' }
      ]
    });
    const recalculations = [];
    const service = createGoogleCalendarService({
      db,
      config: GOOGLE_CONFIG,
      encryptionKey,
      googleClient: fake.googleClient,
      agendaService: {
        recalculateTimeframes(userId, activityId) {
          recalculations.push([userId, activityId]);
        }
      },
      now: () => new Date('2026-07-20T12:00:00.000Z')
    });

    const stats = await service.syncNow(1, { daysBefore: 30, daysAfter: 180 });
    assert.deepEqual(stats, { pushed: 1, pulled: 1, updated: 0, deleted: 1, ignored: 0 });
    assert.equal(fake.calls.inserts.length, 1);
    assert.equal(fake.calls.inserts[0].requestBody.summary, 'Enviar somente da pessoa um');
    assert.equal(fake.calls.lists.length, 1);
    assert.equal(fake.calls.lists[0].calendarId, 'primary');
    assert.equal(fake.calls.lists[0].showDeleted, true);

    const imported = db.get(
      'SELECT * FROM agenda_events WHERE user_id = 1 AND google_event_id = ?',
      ['google-importado']
    );
    assert.equal(imported.activity_id, 11, 'activity_id de outro tenant jamais pode ser usado');
    assert.equal(imported.priority, 'alta');
    assert.equal(imported.cognitive_load, 3);
    assert.equal(imported.duration_hours, 1.5);
    assert.equal(
      db.get('SELECT COUNT(*) AS total FROM agenda_events WHERE id = 102 AND user_id = 1').total,
      0
    );
    assert.equal(
      db.get('SELECT COUNT(*) AS total FROM agenda_events WHERE id = 202 AND user_id = 2').total,
      1,
      'cancelamento remoto da pessoa um não pode apagar mapeamento da pessoa dois'
    );
    assert.equal(
      db.get('SELECT google_event_id FROM agenda_events WHERE id = 201').google_event_id,
      null,
      'evento não sincronizado do outro tenant deve permanecer intocado'
    );
    assert.ok(recalculations.every(([userId]) => userId === 1));

    const stored = db.get('SELECT * FROM google_tokens WHERE user_id = 1');
    const tokens = decryptRow(stored, 1, encryptionKey);
    assert.equal(tokens.access_token, 'acesso-renovado-da-pessoa-um');
    assert.equal(tokens.refresh_token, 'renovacao-um');
  });

  it('bloqueia push/delete de evento alheio antes de chamar o Google', async (t) => {
    const db = createDatabase(t);
    const encryptionKey = randomBytes(32);
    insertToken(db, 1, 'um');
    insertEvent(db, {
      id: 201,
      userId: 2,
      activityId: 22,
      title: 'Evento exclusivo da pessoa dois',
      googleEventId: 'google-da-pessoa-dois'
    });
    const fake = createFakeGoogle();
    const service = createGoogleCalendarService({
      db,
      config: GOOGLE_CONFIG,
      encryptionKey,
      googleClient: fake.googleClient
    });

    await assert.rejects(
      service.pushEvent(1, 201),
      (error) => error.code === 'COMPROMISSO_NAO_ENCONTRADO'
    );
    await assert.rejects(
      service.deleteEvent(1, 201),
      (error) => error.code === 'COMPROMISSO_NAO_ENCONTRADO'
    );
    assert.equal(fake.calls.inserts.length, 0);
    assert.equal(fake.calls.updates.length, 0);
    assert.equal(fake.calls.deletes.length, 0);
  });

  it('revoga remotamente antes de apagar e preserva a conexão quando a revogação falha', async (t) => {
    const db = createDatabase(t);
    const encryptionKey = randomBytes(32);
    insertToken(db, 1, 'um');
    insertToken(db, 2, 'dois');
    insertEvent(db, {
      id: 101,
      userId: 1,
      activityId: 11,
      title: 'Mapeamento um',
      googleEventId: 'google-um'
    });
    insertEvent(db, {
      id: 201,
      userId: 2,
      activityId: 22,
      title: 'Mapeamento dois',
      googleEventId: 'google-dois'
    });

    const failedFake = createFakeGoogle({
      revokeError: Object.assign(new Error('indisponível'), { code: 503 })
    });
    const failedService = createGoogleCalendarService({
      db,
      config: GOOGLE_CONFIG,
      encryptionKey,
      googleClient: failedFake.googleClient
    });
    await assert.rejects(
      failedService.disconnect(1),
      (error) => error.code === 'GOOGLE_API_INDISPONIVEL'
    );
    assert.equal(db.get('SELECT COUNT(*) AS total FROM google_tokens WHERE user_id = 1').total, 1);
    assert.equal(
      db.get('SELECT google_event_id FROM agenda_events WHERE id = 101').google_event_id,
      'google-um'
    );

    const successFake = createFakeGoogle();
    const successService = createGoogleCalendarService({
      db,
      config: GOOGLE_CONFIG,
      encryptionKey,
      googleClient: successFake.googleClient
    });
    await successService.disconnect(1);
    assert.deepEqual(successFake.calls.revoked, ['renovacao-um']);
    assert.equal(db.get('SELECT COUNT(*) AS total FROM google_tokens WHERE user_id = 1').total, 0);
    assert.equal(
      db.get('SELECT google_event_id FROM agenda_events WHERE id = 101').google_event_id,
      null
    );
    assert.equal(db.get('SELECT COUNT(*) AS total FROM google_tokens WHERE user_id = 2').total, 1);
    assert.equal(
      db.get('SELECT google_event_id FROM agenda_events WHERE id = 201').google_event_id,
      'google-dois'
    );
  });
});
