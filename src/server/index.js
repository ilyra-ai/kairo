// ============================================================================
// Kairo — Ponto de entrada do processo e encerramento gracioso
// ============================================================================

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createKairoRuntime } from './runtime.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

export async function startServer(options = {}) {
  const logger = options.logger ?? console;
  const runtime = await createKairoRuntime({ ...options, logger });
  const { app, config } = runtime;

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(config.port, config.host, () => resolve(listener));
    listener.once('error', reject);
  });

  let shutdownPromise = null;
  function shutdown(reason = 'encerramento solicitado') {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = new Promise((resolve, reject) => {
      logger.info({
        evento: 'servidor_encerrando',
        motivo: reason
      });

      const forceTimer = setTimeout(() => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      }, SHUTDOWN_TIMEOUT_MS);
      forceTimer.unref();

      server.close((error) => {
        clearTimeout(forceTimer);
        try {
          runtime.close();
        } catch (closeError) {
          return reject(closeError);
        }
        if (error) return reject(error);
        resolve();
      });
    });
    return shutdownPromise;
  }

  logger.info({
    evento: 'servidor_iniciado',
    endereco: `http://${config.host}:${config.port}`,
    ambiente: config.nodeEnv,
    bancoLegadoRelocado: Boolean(runtime.relocation.relocated)
  });

  return Object.freeze({ runtime, server, shutdown });
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  let running;
  try {
    running = await startServer();
  } catch (error) {
    console.error({
      evento: 'falha_inicializacao',
      mensagem: error?.message
    });
    process.exitCode = 1;
  }

  if (running) {
    const handleSignal = (signal) => {
      running.shutdown(signal).catch((error) => {
        console.error({
          evento: 'falha_encerramento',
          mensagem: error?.message
        });
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
  }
}
