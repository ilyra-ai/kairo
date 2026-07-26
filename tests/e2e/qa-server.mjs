import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_QA } from './support/credentials.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDirectory, '../..');
const outputDirectory = resolve(projectRoot, 'test-results/e2e-runtime');
const databasePath = resolve(outputDirectory, 'kairo-e2e.sqlite');

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

process.env.PORT = process.env.PORT || '3214';
process.env.NODE_ENV = 'development';
process.env.KAIRO_DB_PATH = databasePath;
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ||
  'kairo-e2e-session-secret-2026-com-tamanho-suficiente-para-validacao-segura';
// O servidor E2E usa um banco descartável e precisa semear exatamente a conta
// conhecida pelo suporte de autenticação. Isso impede que credenciais pessoais
// carregadas do .env contaminem o isolamento ou façam o teste aguardar até timeout.
process.env.SEED_ADMIN_ENABLED = 'true';
process.env.SEED_ADMIN_NAME = ADMIN_QA.nome;
process.env.SEED_ADMIN_EMAIL = ADMIN_QA.email;
process.env.SEED_ADMIN_PASSWORD = ADMIN_QA.senha;

const { startServer } = await import('../../src/server/index.js');

const logger = {
  info() {},
  warn(message) {
    console.warn(message);
  },
  error(message) {
    console.error(message);
  }
};

const runningServer = await startServer({
  logger,
  relocateLegacy: false
});

async function shutdown(signal) {
  try {
    await runningServer.shutdown(signal);
    process.exit(0);
  } catch (error) {
    console.error({
      evento: 'falha_encerramento_e2e',
      mensagem: error?.message
    });
    process.exit(1);
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
