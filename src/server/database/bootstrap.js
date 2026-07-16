// ============================================================================
// Kairo — Relocação segura do banco legado e seleção do proprietário
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { openSqliteClient } from './sqlite-client.js';

function timestamp(now = new Date()) {
  return now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function listTableCounts(db) {
  const tables = db.all(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `);
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      Number(db.get(`SELECT COUNT(*) AS total FROM "${name}"`).total)
    ])
  );
}

function assertHealthy(db, label) {
  const integrity = db.integrityCheck();
  if (!integrity.every((row) => row.integrity_check === 'ok')) {
    throw new Error(`${label} não passou no PRAGMA integrity_check.`);
  }
}

function writeReport(filename, report) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
}

export function relocateLegacyDatabase(options) {
  const { legacyDatabasePath, targetDatabasePath, backupsDirectory, now = new Date() } = options;

  const legacy = path.resolve(legacyDatabasePath);
  const target = path.resolve(targetDatabasePath);
  if (legacy === target) {
    throw new Error('O banco legado e o banco de destino não podem usar o mesmo caminho.');
  }
  if (fs.existsSync(target) || !fs.existsSync(legacy)) {
    return {
      relocated: false,
      legacyExists: fs.existsSync(legacy),
      targetExists: fs.existsSync(target)
    };
  }

  const suffix = timestamp(now);
  const backupPath = path.join(backupsDirectory, `database-legado-${suffix}.backup.sqlite`);
  const reportPath = path.join(backupsDirectory, `database-legado-${suffix}.relatorio.json`);
  const source = openSqliteClient(legacy);

  try {
    assertHealthy(source, 'O banco legado');
    const before = listTableCounts(source);
    source.backupSync(backupPath);
    source.backupSync(target);

    const copied = openSqliteClient(target);
    try {
      assertHealthy(copied, 'A cópia segura do banco');
      const after = listTableCounts(copied);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error('As contagens da cópia não correspondem ao banco legado.');
      }

      writeReport(reportPath, {
        operation: 'relocacao_banco_legado',
        completedAt: now.toISOString(),
        source: legacy,
        target,
        backup: backupPath,
        countsBefore: before,
        countsAfter: after,
        integrity: 'ok',
        legacyPreserved: true
      });
      return { relocated: true, backupPath, reportPath, counts: after };
    } catch (error) {
      copied.close();
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      throw error;
    } finally {
      if (copied.open) copied.close();
    }
  } finally {
    source.close();
  }
}

export function resolveMigrationOwner(db, configuredEmail) {
  const users = db.all(
    `SELECT id, name, email, role FROM users
     WHERE is_active = 1
     ORDER BY CASE WHEN role = 'administrador' THEN 0 ELSE 1 END, id`
  );
  if (users.length === 0) return null;

  if (configuredEmail) {
    const selected = users.find(
      (user) => user.email.toLowerCase() === configuredEmail.toLowerCase()
    );
    if (!selected) {
      throw new Error('MIGRATION_OWNER_EMAIL não corresponde a um usuário ativo existente.');
    }
    return selected;
  }

  if (users.length === 1) return users[0];
  const administrators = users.filter((user) => user.role === 'administrador');
  if (administrators.length === 1) return administrators[0];

  throw new Error(
    'Existem vários usuários possíveis para os dados legados. Defina MIGRATION_OWNER_EMAIL antes de iniciar.'
  );
}
