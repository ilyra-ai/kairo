import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const arquivoAtual = fileURLToPath(import.meta.url);
const raizRepositorio = path.resolve(path.dirname(arquivoAtual), '..', '..');

function executarBatch(diretorio, argumentos, opcoes = {}) {
  const comando = `run.bat ${argumentos.join(' ')}`;
  return spawnSync('cmd.exe', ['/D', '/S', '/C', comando], {
    cwd: diretorio,
    encoding: 'utf8',
    timeout: opcoes.timeout ?? 120_000,
    windowsHide: true
  });
}

function resumoExecucao(resultado) {
  return [resultado.stdout, resultado.stderr].filter(Boolean).join('\n');
}

function hashArquivo(caminho) {
  return createHash('sha256').update(readFileSync(caminho)).digest('hex');
}

async function obterPortaLivre() {
  const servidor = net.createServer();
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });
  const endereco = servidor.address();
  await new Promise((resolve) => servidor.close(resolve));
  return endereco.port;
}

async function requisitar(porta) {
  return new Promise((resolve, reject) => {
    const requisicao = http.get(
      { host: '127.0.0.1', port: porta, path: '/', timeout: 10_000 },
      (resposta) => {
        let corpo = '';
        resposta.setEncoding('utf8');
        resposta.on('data', (parte) => {
          corpo += parte;
        });
        resposta.on('end', () => resolve({ status: resposta.statusCode, corpo }));
      }
    );
    requisicao.once('timeout', () => requisicao.destroy(new Error('Tempo de resposta excedido.')));
    requisicao.once('error', reject);
  });
}

async function aguardarHttpPronto(porta, limiteMs = 15_000) {
  const inicio = Date.now();
  let ultimoErro;

  while (Date.now() - inicio < limiteMs) {
    try {
      return await requisitar(porta);
    } catch (erro) {
      ultimoErro = erro;
      if (!['ECONNREFUSED', 'ECONNRESET'].includes(erro.code)) throw erro;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw new Error(
    `O servidor não ficou pronto para HTTP em ${limiteMs} ms: ${ultimoErro?.message ?? 'sem resposta'}`,
    { cause: ultimoErro }
  );
}

async function portaAceitaConexao(porta) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: porta });
    const concluir = (resultado) => {
      socket.destroy();
      resolve(resultado);
    };
    socket.setTimeout(500, () => concluir(false));
    socket.once('connect', () => concluir(true));
    socket.once('error', () => concluir(false));
  });
}

async function aguardarPortaFechada(porta, limiteMs = 5_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    if (!(await portaAceitaConexao(porta))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

test(
  'run.bat executa o ciclo operacional completo com segurança no Windows',
  { skip: process.platform !== 'win32', timeout: 180_000 },
  async (contexto) => {
    const raizTemporaria = path.resolve(os.tmpdir());
    const diretorioQa = mkdtempSync(path.join(raizTemporaria, 'Kairo QA com espacos '));
    assert.equal(
      diretorioQa.startsWith(`${raizTemporaria}${path.sep}`),
      true,
      'O diretório de QA precisa permanecer dentro da pasta temporária.'
    );

    let servidorAtivo = false;
    let servidorPid = null;
    contexto.after(() => {
      if (servidorAtivo) {
        const parada = executarBatch(diretorioQa, ['--no-bootstrap', '--action', 'STOP']);
        if (parada.status !== 0 && Number.isInteger(servidorPid)) {
          spawnSync('taskkill.exe', ['/PID', String(servidorPid), '/T', '/F'], {
            encoding: 'utf8',
            windowsHide: true
          });
        }
      }
      rmSync(diretorioQa, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    });

    const ignorados = new Set([
      '.git',
      '.orchestrator',
      'coverage',
      'node_modules',
      'storage',
      'test-results',
      '.env',
      '10-KAIRO.zip',
      'kairo.sh',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml'
    ]);
    cpSync(raizRepositorio, diretorioQa, {
      recursive: true,
      filter(origem) {
        const relativo = path.relative(raizRepositorio, origem);
        if (!relativo) return true;
        return !ignorados.has(relativo.split(path.sep)[0]);
      }
    });
    writeFileSync(path.join(diretorioQa, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8');
    const ajuda = executarBatch(diretorioQa, ['--help']);
    assert.equal(ajuda.status, 0, resumoExecucao(ajuda));
    assert.match(ajuda.stdout, /Uso: run\.bat/);

    const lista = executarBatch(diretorioQa, ['--no-bootstrap', '--list-actions']);
    assert.equal(lista.status, 0, resumoExecucao(lista));
    assert.match(lista.stdout, /START_PROD/);
    assert.match(lista.stdout, /Dependências Node\.js via npm/);
    assert.doesNotMatch(lista.stdout, /Dependências Node\.js via pnpm/);

    const lockfile = path.join(diretorioQa, 'package-lock.json');
    const hashAntes = hashArquivo(lockfile);
    const bootstrap = executarBatch(diretorioQa, ['--bootstrap-only']);
    assert.equal(bootstrap.status, 0, resumoExecucao(bootstrap));
    assert.equal(hashArquivo(lockfile), hashAntes, 'O bootstrap não pode alterar o lockfile.');
    assert.equal(existsSync(path.join(diretorioQa, 'node_modules')), true);

    const sqlite = spawnSync(
      process.execPath,
      [
        '-e',
        "const Database=require('better-sqlite3');const db=new Database(':memory:');db.prepare('select 1').get();db.close();"
      ],
      { cwd: diretorioQa, encoding: 'utf8', windowsHide: true }
    );
    assert.equal(sqlite.status, 0, resumoExecucao(sqlite));

    const porta = await obterPortaLivre();
    const iniciar = executarBatch(diretorioQa, [
      '--no-bootstrap',
      '--action',
      'START_PROD',
      '--port',
      String(porta)
    ]);
    assert.equal(iniciar.status, 0, resumoExecucao(iniciar));
    servidorAtivo = true;
    const primeiraResposta = await aguardarHttpPronto(porta);
    assert.equal(primeiraResposta.status, 200);
    assert.match(primeiraResposta.corpo, /Kairo/);
    const metadadosPath = path.join(diretorioQa, '.orchestrator', 'server-windows.json');
    const pidPath = path.join(diretorioQa, '.orchestrator', 'server-windows.pid');
    const primeirosMetadadosRaw = readFileSync(metadadosPath, 'utf8');
    const primeirosMetadados = JSON.parse(primeirosMetadadosRaw);
    const primeiroPid = primeirosMetadados.Pid;
    servidorPid = primeiroPid;

    const commandFileAdulterado = path.join(diretorioQa, 'comando-adulterado.cmd');
    const commandFileJson = JSON.stringify(commandFileAdulterado);
    writeFileSync(
      metadadosPath,
      primeirosMetadadosRaw.replace(
        /"CommandFile"\s*:\s*"(?:\\.|[^"\\])*"/,
        `"CommandFile": ${commandFileJson}`
      ),
      'utf8'
    );
    const paradaComMetadadosAdulterados = executarBatch(diretorioQa, [
      '--no-bootstrap',
      '--action',
      'STOP'
    ]);
    assert.equal(
      paradaComMetadadosAdulterados.status,
      3,
      resumoExecucao(paradaComMetadadosAdulterados)
    );
    assert.equal((await aguardarHttpPronto(porta)).status, 200);
    writeFileSync(metadadosPath, primeirosMetadadosRaw, 'utf8');
    writeFileSync(pidPath, String(primeiroPid), 'ascii');

    const parar = executarBatch(diretorioQa, ['--no-bootstrap', '--action', 'STOP']);
    assert.equal(parar.status, 0, resumoExecucao(parar));
    servidorAtivo = false;
    servidorPid = null;
    assert.equal(await aguardarPortaFechada(porta), true);
    assert.equal(existsSync(metadadosPath), false);
    assert.equal(existsSync(pidPath), false);
    assert.equal(existsSync(primeirosMetadados.CommandFile), false);

    const reiniciar = executarBatch(diretorioQa, [
      '--no-bootstrap',
      '--action',
      'START_PROD',
      '--port',
      String(porta)
    ]);
    assert.equal(reiniciar.status, 0, resumoExecucao(reiniciar));
    servidorAtivo = true;
    const segundoPid = JSON.parse(
      readFileSync(path.join(diretorioQa, '.orchestrator', 'server-windows.json'), 'utf8')
    ).Pid;
    servidorPid = segundoPid;
    assert.notEqual(
      segundoPid,
      primeiroPid,
      'O reinício precisa criar uma nova árvore de processo.'
    );
    assert.equal((await aguardarHttpPronto(porta)).status, 200);
    assert.equal(executarBatch(diretorioQa, ['--no-bootstrap', '--action', 'STOP']).status, 0);
    servidorAtivo = false;
    servidorPid = null;
    assert.equal(await aguardarPortaFechada(porta), true);
    assert.equal(existsSync(metadadosPath), false);

    const portaOcupada = await obterPortaLivre();
    const externo = net.createServer();
    await new Promise((resolve, reject) => {
      externo.once('error', reject);
      externo.listen(portaOcupada, '127.0.0.1', resolve);
    });
    try {
      const tentativa = executarBatch(diretorioQa, [
        '--no-bootstrap',
        '--action',
        'START_PROD',
        '--port',
        String(portaOcupada)
      ]);
      assert.equal(tentativa.status, 1, resumoExecucao(tentativa));
      assert.match(resumoExecucao(tentativa), /nenhum processo externo foi encerrado/);
      assert.equal(externo.listening, true, 'O processo externo precisa permanecer ativo.');
    } finally {
      await new Promise((resolve) => externo.close(resolve));
    }
  }
);
