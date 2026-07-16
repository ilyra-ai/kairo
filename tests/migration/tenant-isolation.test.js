import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CORE_TABLES,
  ensureCoreSchema,
  ensureUserWorkspace,
  inspectCoreSchema,
  migrateTenantIsolation,
  openSqliteClient,
  resetUserWorkspace
} from '../../src/server/database/index.js';

function createTestContext(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-tenant-test-'));
  const databasePath = path.join(directory, 'database.sqlite');
  const db = openSqliteClient(databasePath);
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, directory, databasePath };
}

function createUsers(db, users = [{ id: 1, name: 'Administrador', email: 'admin@kairo.local' }]) {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT 'hash-de-teste',
      role TEXT NOT NULL DEFAULT 'free',
      plan TEXT NOT NULL DEFAULT 'free',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  for (const user of users) {
    db.run(
      `INSERT INTO users (id, name, email, password_hash, role, plan, is_active)
       VALUES (?, ?, ?, 'hash-de-teste', 'free', 'free', 1)`,
      [user.id, user.name, user.email]
    );
  }
}

function columnNames(db, tableName) {
  return db.all(`PRAGMA table_info("${tableName}")`).map((column) => column.name);
}

test('1. transaction(work) é síncrona, reverte falhas e gera backup consistente', (t) => {
  const { db, directory } = createTestContext(t);
  db.exec('CREATE TABLE ledger (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');

  assert.throws(() => {
    db.transaction((transactionDb) => {
      transactionDb.run('INSERT INTO ledger (id, value) VALUES (?, ?)', [1, 'não persistir']);
      throw new Error('falha deliberada');
    });
  }, /falha deliberada/);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM ledger').total, 0);

  assert.throws(() => {
    db.transaction(async (transactionDb) => {
      transactionDb.run('INSERT INTO ledger (id, value) VALUES (?, ?)', [2, 'promessa proibida']);
    });
  }, /Promises não são permitidas/);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM ledger').total, 0);

  db.transaction((transactionDb) => {
    transactionDb.run('INSERT INTO ledger (id, value) VALUES (?, ?)', [3, 'persistido']);
  });
  const backupPath = path.join(directory, 'backup.sqlite');
  assert.equal(db.backupSync(backupPath), backupPath);
  assert.ok(fs.statSync(backupPath).size > 0);

  const backup = openSqliteClient(backupPath, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(backup.get('SELECT id, value FROM ledger'), { id: 3, value: 'persistido' });
  } finally {
    backup.close();
  }
});

test('2. migração recusa proprietário inexistente antes de alterar ou copiar dados', (t) => {
  const { db, directory } = createTestContext(t);
  createUsers(db);
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO activities (title) VALUES ('Dado legado íntegro');
  `);
  const backupPath = path.join(directory, 'não-deve-existir.sqlite');

  assert.throws(
    () => ensureCoreSchema(db, 999, { backupPath }),
    /proprietário 999 não existe/
  );
  assert.equal(fs.existsSync(backupPath), false);
  assert.deepEqual(columnNames(db, 'activities'), ['id', 'title', 'created_at']);
  assert.equal(db.get('SELECT activities.title FROM activities').title, 'Dado legado íntegro');
});

test('3. foreign_key_check roda antes do commit e uma violação restaura o esquema legado', (t) => {
  const { db, directory } = createTestContext(t);
  createUsers(db, [
    { id: 1, name: 'Pessoa Um', email: 'um@kairo.local' },
    { id: 2, name: 'Pessoa Dois', email: 'dois@kairo.local' }
  ]);
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE agenda_events (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      activity_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      event_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      duration_hours REAL NOT NULL
    );
    INSERT INTO activities (id, user_id, title) VALUES (10, 1, 'Atividade da pessoa um');
    INSERT INTO agenda_events
      (id, user_id, activity_id, title, event_date, start_time, end_time, duration_hours)
    VALUES (20, 2, 10, 'Referência cruzada inválida', '2026-07-16', '09:00', '10:00', 1);
  `);
  const backupPath = path.join(directory, 'antes-da-migracao.sqlite');

  assert.throws(
    () => migrateTenantIsolation(db, 1, { backupPath }),
    /revertida antes do commit por 1 violação/
  );
  assert.equal(fs.existsSync(backupPath), true);
  assert.equal(db.get("SELECT COUNT(*) AS total FROM sqlite_master WHERE name LIKE '%_legacy_tenant'").total, 0);
  assert.deepEqual(columnNames(db, 'agenda_events'), [
    'id', 'user_id', 'activity_id', 'title', 'event_date', 'start_time', 'end_time', 'duration_hours'
  ]);
  assert.equal(db.get('SELECT agenda_events.user_id FROM agenda_events').user_id, 2);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('4. auditoria estrutural reconstrói todas as tabelas quando apenas activities parecia correta', (t) => {
  const { db, directory } = createTestContext(t);
  createUsers(db);
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      UNIQUE (user_id, title),
      UNIQUE (id, user_id)
    );
    CREATE TABLE agenda_events (
      id INTEGER PRIMARY KEY,
      activity_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      event_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      duration_hours REAL NOT NULL
    );
    INSERT INTO activities (id, user_id, title) VALUES (1, 1, 'Atividade preservada');
    INSERT INTO agenda_events
      (id, activity_id, title, event_date, start_time, end_time, duration_hours)
    VALUES (1, 1, 'Evento preservado', '2026-07-16', '08:00', '09:00', 1);
  `);

  const result = ensureCoreSchema(db, 1, { backupDirectory: directory });
  assert.equal(result.migrated, true);
  assert.equal(inspectCoreSchema(db).valid, true);
  for (const tableName of CORE_TABLES) {
    assert.equal(
      db.get("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName]).total,
      1,
      `A tabela ${tableName} deveria existir`
    );
  }
  assert.ok(columnNames(db, 'agenda_events').includes('user_id'));
  assert.equal(db.get('SELECT agenda_events.user_id FROM agenda_events').user_id, 1);
});

test('5. cópia usa colunas qualificadas e preserva agenda tenant sem ambiguidade SQL', (t) => {
  const { db, directory } = createTestContext(t);
  createUsers(db);
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE agenda_events (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      activity_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      event_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      duration_hours REAL NOT NULL,
      is_completed INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'media',
      cognitive_load INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO activities (id, user_id, title) VALUES (7, 1, 'Atividade qualificada');
    INSERT INTO agenda_events
      (id, user_id, activity_id, title, description, event_date, start_time, end_time, duration_hours)
    VALUES (8, 1, 7, 'Evento qualificado', 'Sem colisão', '2026-07-17', '10:00', '11:30', 1.5);
  `);

  assert.doesNotThrow(() => ensureCoreSchema(db, 1, { backupDirectory: directory }));
  assert.deepEqual(
    db.get(`
      SELECT agenda_events.user_id, agenda_events.activity_id, agenda_events.title,
             agenda_events.description, agenda_events.duration_hours
      FROM agenda_events
      WHERE agenda_events.id = 8
    `),
    {
      user_id: 1,
      activity_id: 7,
      title: 'Evento qualificado',
      description: 'Sem colisão',
      duration_hours: 1.5
    }
  );
});

test('6. remigração multiusuário preserva todos os perfis e tokens sem LIMIT 1', (t) => {
  const { db, directory } = createTestContext(t);
  createUsers(db, [
    { id: 1, name: 'Pessoa Um', email: 'um@kairo.local' },
    { id: 2, name: 'Pessoa Dois', email: 'dois@kairo.local' }
  ]);
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE profile_data (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      theme TEXT DEFAULT 'escuro',
      focus_sound TEXT DEFAULT 'chuva',
      enable_confetti INTEGER DEFAULT 1
    );
    CREATE TABLE google_tokens (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      calendar_id TEXT DEFAULT 'primary'
    );
    INSERT INTO activities (id, user_id, title) VALUES
      (1, 1, 'Privada um'),
      (2, 2, 'Privada dois');
    INSERT INTO profile_data (id, user_id, username, email) VALUES
      (1, 1, 'Perfil Um', 'um@kairo.local'),
      (2, 2, 'Perfil Dois', 'dois@kairo.local');
    INSERT INTO google_tokens (id, user_id, access_token, refresh_token) VALUES
      (1, 1, 'acesso-um', 'renovacao-um'),
      (2, 2, 'acesso-dois', 'renovacao-dois');
  `);

  ensureCoreSchema(db, 1, { backupDirectory: directory });
  assert.deepEqual(
    db.all('SELECT profile_data.user_id, profile_data.username FROM profile_data ORDER BY profile_data.user_id'),
    [
      { user_id: 1, username: 'Perfil Um' },
      { user_id: 2, username: 'Perfil Dois' }
    ]
  );
  assert.deepEqual(
    db.all('SELECT google_tokens.user_id, google_tokens.access_token FROM google_tokens ORDER BY google_tokens.user_id'),
    [
      { user_id: 1, access_token: 'acesso-um' },
      { user_id: 2, access_token: 'acesso-dois' }
    ]
  );
});

test('7. criação e reset do workspace são atômicos até diante de falha durante o seed', (t) => {
  const { db } = createTestContext(t);
  createUsers(db, [
    { id: 1, name: 'Pessoa Um', email: 'um@kairo.local' },
    { id: 2, name: 'Pessoa Dois', email: 'dois@kairo.local' }
  ]);
  ensureCoreSchema(db, 1);
  const created = ensureUserWorkspace(db, { id: 1 });
  assert.deepEqual(created, { created: true, activities: 6 });
  assert.equal(db.get('SELECT COUNT(*) AS total FROM timeframes').total, 18);
  assert.equal(db.get('SELECT SUM(current + previous) AS total FROM timeframes').total, 0);

  const originalActivities = db.all(
    `SELECT activities.id, activities.title
     FROM activities
     WHERE activities.user_id = 1
     ORDER BY activities.id`
  );
  const originalTimeframes = db.all(
    `SELECT timeframes.id, timeframes.activity_id, timeframes.type, timeframes.current, timeframes.previous
     FROM timeframes
     JOIN activities ON activities.id = timeframes.activity_id
     WHERE activities.user_id = 1
     ORDER BY timeframes.id`
  );

  db.exec(`
    CREATE TRIGGER impedir_seed_de_teste
    BEFORE INSERT ON timeframes
    WHEN NEW.type = 'weekly'
    BEGIN
      SELECT RAISE(ABORT, 'falha deliberada no seed');
    END;
  `);

  assert.throws(() => ensureUserWorkspace(db, { id: 2 }), /falha deliberada no seed/);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM profile_data WHERE user_id = 2').total, 0);
  assert.equal(db.get('SELECT COUNT(*) AS total FROM activities WHERE user_id = 2').total, 0);

  assert.throws(() => resetUserWorkspace(db, { id: 1 }), /falha deliberada no seed/);
  assert.deepEqual(
    db.all(`
      SELECT activities.id, activities.title
      FROM activities
      WHERE activities.user_id = 1
      ORDER BY activities.id
    `),
    originalActivities
  );
  assert.deepEqual(
    db.all(`
      SELECT timeframes.id, timeframes.activity_id, timeframes.type, timeframes.current, timeframes.previous
      FROM timeframes
      JOIN activities ON activities.id = timeframes.activity_id
      WHERE activities.user_id = 1
      ORDER BY timeframes.id
    `),
    originalTimeframes
  );
});
