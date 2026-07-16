// ============================================================================
// Kairo — Relocação segura do banco legado e seleção do proprietário
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  relocateLegacyDatabase,
  resolveMigrationOwner
} from '../../src/server/database/bootstrap.js';
import { openSqliteClient } from '../../src/server/database/index.js';
import { ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';

const FIXED_NOW = new Date('2026-07-16T12:34:56.789Z');

function createTemporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-bootstrap-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function createLegacyDatabase(filename) {
  const db = openSqliteClient(filename);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );
    CREATE TABLE registros (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      conteudo TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    );
    INSERT INTO users (id, name, email) VALUES
      (1, 'Pessoa Um', 'um@kairo.local'),
      (2, 'Pessoa Dois', 'dois@kairo.local');
    INSERT INTO registros (id, user_id, conteudo) VALUES
      (10, 1, 'registro preservado um'),
      (20, 2, 'registro preservado dois'),
      (30, 2, 'registro preservado três');
  `);
  db.close();
}

test('relocação cria cópia íntegra, backup independente e relatório sem apagar o legado', (t) => {
  const directory = createTemporaryDirectory(t);
  const legacyPath = path.join(directory, 'database.sqlite');
  const targetPath = path.join(directory, 'storage', 'data', 'kairo.sqlite');
  const backupsDirectory = path.join(directory, 'storage', 'backups');
  createLegacyDatabase(legacyPath);

  const result = relocateLegacyDatabase({
    legacyDatabasePath: legacyPath,
    targetDatabasePath: targetPath,
    backupsDirectory,
    now: FIXED_NOW
  });

  assert.equal(result.relocated, true);
  assert.equal(fs.existsSync(legacyPath), true);
  assert.equal(fs.existsSync(targetPath), true);
  assert.equal(fs.existsSync(result.backupPath), true);
  assert.equal(fs.existsSync(result.reportPath), true);
  assert.deepEqual(result.counts, { registros: 3, users: 2 });
  assert.notEqual(path.resolve(result.backupPath), path.resolve(targetPath));

  const report = JSON.parse(fs.readFileSync(result.reportPath, 'utf8'));
  assert.deepEqual(report.countsBefore, { registros: 3, users: 2 });
  assert.deepEqual(report.countsAfter, report.countsBefore);
  assert.equal(report.integrity, 'ok');
  assert.equal(report.legacyPreserved, true);
  assert.equal(report.completedAt, FIXED_NOW.toISOString());
  assert.equal(report.source, path.resolve(legacyPath));
  assert.equal(report.target, path.resolve(targetPath));

  const target = openSqliteClient(targetPath, { readonly: true, fileMustExist: true });
  const backup = openSqliteClient(result.backupPath, { readonly: true, fileMustExist: true });
  const legacy = openSqliteClient(legacyPath, { readonly: true, fileMustExist: true });
  try {
    for (const database of [target, backup, legacy]) {
      assert.deepEqual(database.integrityCheck(), [{ integrity_check: 'ok' }]);
      assert.equal(database.foreignKeyCheck().length, 0);
      assert.deepEqual(
        database.all('SELECT id, user_id, conteudo FROM registros ORDER BY id'),
        [
          { id: 10, user_id: 1, conteudo: 'registro preservado um' },
          { id: 20, user_id: 2, conteudo: 'registro preservado dois' },
          { id: 30, user_id: 2, conteudo: 'registro preservado três' }
        ]
      );
    }
  } finally {
    target.close();
    backup.close();
    legacy.close();
  }
});

test('relocação é idempotente quando origem falta ou destino já existe e nunca sobrescreve destino', (t) => {
  const directory = createTemporaryDirectory(t);
  const missingLegacy = path.join(directory, 'ausente.sqlite');
  const targetPath = path.join(directory, 'destino.sqlite');
  const backupsDirectory = path.join(directory, 'backups');

  assert.deepEqual(relocateLegacyDatabase({
    legacyDatabasePath: missingLegacy,
    targetDatabasePath: targetPath,
    backupsDirectory,
    now: FIXED_NOW
  }), {
    relocated: false,
    legacyExists: false,
    targetExists: false
  });

  const legacyPath = path.join(directory, 'legado.sqlite');
  createLegacyDatabase(legacyPath);
  const target = openSqliteClient(targetPath);
  target.exec('CREATE TABLE marcador (valor TEXT NOT NULL); INSERT INTO marcador VALUES (\'não sobrescrever\');');
  target.close();

  assert.deepEqual(relocateLegacyDatabase({
    legacyDatabasePath: legacyPath,
    targetDatabasePath: targetPath,
    backupsDirectory,
    now: FIXED_NOW
  }), {
    relocated: false,
    legacyExists: true,
    targetExists: true
  });
  const preserved = openSqliteClient(targetPath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(preserved.get('SELECT valor FROM marcador').valor, 'não sobrescrever');
  } finally {
    preserved.close();
  }
  assert.equal(fs.existsSync(backupsDirectory), false);
});

test('origem e destino iguais são recusados explicitamente antes de qualquer operação', (t) => {
  const directory = createTemporaryDirectory(t);
  const databasePath = path.join(directory, 'database.sqlite');
  createLegacyDatabase(databasePath);

  assert.throws(
    () => relocateLegacyDatabase({
      legacyDatabasePath: databasePath,
      targetDatabasePath: databasePath,
      backupsDirectory: path.join(directory, 'backups'),
      now: FIXED_NOW
    }),
    /não podem usar o mesmo caminho/
  );
  const legacy = openSqliteClient(databasePath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(legacy.get('SELECT COUNT(*) AS total FROM registros').total, 3);
  } finally {
    legacy.close();
  }
});

test('seleção do proprietário respeita e-mail configurado, atividade e ambiguidade administrativa', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-bootstrap-owner-test-'));
  const db = openSqliteClient(path.join(directory, 'owners.sqlite'));
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  ensureAuthSchema(db);

  assert.equal(resolveMigrationOwner(db), null);
  db.run(
    `INSERT INTO users (id, name, email, password_hash, role, plan, is_active)
     VALUES (1, 'Administrador Um', 'admin.um@kairo.local', 'hash', 'administrador', 'pro', 1)`
  );
  assert.equal(resolveMigrationOwner(db).id, 1);

  db.run(
    `INSERT INTO users (id, name, email, password_hash, role, plan, is_active)
     VALUES (2, 'Pessoa Comum', 'pessoa@kairo.local', 'hash', 'usuario', 'plus', 1)`
  );
  db.run(
    `INSERT INTO users (id, name, email, password_hash, role, plan, is_active)
     VALUES (3, 'Admin Inativo', 'inativo@kairo.local', 'hash', 'administrador', 'pro', 0)`
  );
  assert.equal(resolveMigrationOwner(db).id, 1);
  assert.equal(resolveMigrationOwner(db, 'PESSOA@KAIRO.LOCAL').id, 2);
  assert.throws(
    () => resolveMigrationOwner(db, 'inativo@kairo.local'),
    /não corresponde a um usuário ativo/
  );

  db.run("UPDATE users SET role = 'administrador' WHERE id = 2");
  assert.throws(
    () => resolveMigrationOwner(db),
    /Existem vários usuários possíveis/
  );
  assert.equal(resolveMigrationOwner(db, 'admin.um@kairo.local').id, 1);
});
