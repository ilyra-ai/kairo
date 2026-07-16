// ============================================================================
// Kairo — Cliente SQLite síncrono, transacional e auditável
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

function normalizeLastInsertRowId(value) {
  if (typeof value !== 'bigint') return value;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

function executeStatement(statement, method, parameters) {
  if (parameters === undefined || parameters === null) return statement[method]();
  if (Array.isArray(parameters)) return statement[method](...parameters);
  return statement[method](parameters);
}

function ensureSynchronousResult(result) {
  if (result && typeof result.then === 'function') {
    throw new TypeError('O trabalho transacional precisa ser síncrono; Promises não são permitidas.');
  }
  return result;
}

function quoteSqliteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export class SqliteClient {
  constructor(filename, options = {}) {
    if (!filename || typeof filename !== 'string') {
      throw new TypeError('O caminho do banco SQLite é obrigatório.');
    }

    this.filename = filename === ':memory:' ? filename : path.resolve(filename);
    if (this.filename !== ':memory:') {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    }

    this.connection = new BetterSqlite3(this.filename, {
      fileMustExist: false,
      timeout: 5000,
      ...options
    });

    this.connection.pragma('foreign_keys = ON');
    this.connection.pragma('busy_timeout = 5000');
    this.connection.pragma('trusted_schema = OFF');
    if (!options.readonly && this.filename !== ':memory:') {
      this.connection.pragma('journal_mode = WAL');
      this.connection.pragma('synchronous = NORMAL');
    }
  }

  exec(sql) {
    return this.connection.exec(sql);
  }

  run(sql, parameters) {
    const information = executeStatement(this.connection.prepare(sql), 'run', parameters);
    return {
      changes: information.changes,
      lastID: normalizeLastInsertRowId(information.lastInsertRowid),
      lastInsertRowid: normalizeLastInsertRowId(information.lastInsertRowid)
    };
  }

  get(sql, parameters) {
    return executeStatement(this.connection.prepare(sql), 'get', parameters);
  }

  all(sql, parameters) {
    return executeStatement(this.connection.prepare(sql), 'all', parameters);
  }

  pragma(source, options) {
    return this.connection.pragma(source, options);
  }

  /**
   * Executa imediatamente `work` dentro de uma transação real do better-sqlite3.
   * Qualquer exceção desfaz todas as operações; trabalhos assíncronos são rejeitados.
   */
  transaction(work, ...args) {
    if (typeof work !== 'function') {
      throw new TypeError('O trabalho da transação precisa ser uma função.');
    }

    const execute = this.connection.transaction((transactionArgs) => {
      return ensureSynchronousResult(work(this, ...transactionArgs));
    });
    return execute(args);
  }

  /**
   * Backup online oficial do better-sqlite3. A API é assíncrona por definição.
   */
  async backup(destination, options) {
    const resolvedDestination = path.resolve(destination);
    fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });
    await this.connection.backup(resolvedDestination, options);
    return resolvedDestination;
  }

  /**
   * Snapshot síncrono consistente para o ritual de migração.
   * `VACUUM INTO` copia inclusive bancos em WAL sem copiar arquivos incompletos.
   */
  backupSync(destination) {
    if (this.connection.inTransaction) {
      throw new Error('O backup preventivo precisa ser criado antes de iniciar a transação.');
    }

    const resolvedDestination = path.resolve(destination);
    if (resolvedDestination === this.filename) {
      throw new Error('O destino do backup precisa ser diferente do banco de origem.');
    }
    if (fs.existsSync(resolvedDestination)) {
      throw new Error(`O backup já existe e não será sobrescrito: ${resolvedDestination}`);
    }

    fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });
    this.connection.exec(`VACUUM main INTO ${quoteSqliteLiteral(resolvedDestination)}`);
    return resolvedDestination;
  }

  foreignKeyCheck() {
    return this.connection.pragma('foreign_key_check');
  }

  integrityCheck() {
    return this.connection.pragma('integrity_check');
  }

  get inTransaction() {
    return this.connection.inTransaction;
  }

  get open() {
    return this.connection.open;
  }

  close() {
    if (this.connection.open) this.connection.close();
  }
}

export function openSqliteClient(filename, options) {
  return new SqliteClient(filename, options);
}
