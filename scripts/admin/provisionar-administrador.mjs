/**
 * Provisionamento administrativo do Kairo.
 *
 * Cria — ou promove, quando já existir — uma conta com perfil `administrador`
 * e plano `pro`, utilizando o próprio serviço de autenticação da aplicação.
 * Isso garante hash real de senha (bcrypt), validação do plano, inicialização
 * do workspace do usuário e registro em auditoria, exatamente como acontece
 * pela interface administrativa.
 *
 * Uso:
 *   node scripts/admin/provisionar-administrador.mjs --email <e-mail> --senha <senha> [--nome <nome>]
 *
 * Observações de segurança:
 * - Nenhuma credencial é gravada neste arquivo; tudo vem por argumento.
 * - A senha nunca é impressa no console nem registrada em log.
 * - O script é idempotente: rodar novamente apenas realinha perfil, plano e senha.
 */

import { createKairoRuntime } from '../../src/server/runtime.js';

const PERFIL_ADMINISTRADOR = 'administrador';
const PLANO_COMPLETO = 'pro';

function lerArgumentos(argv) {
  const argumentos = new Map();
  for (let indice = 0; indice < argv.length; indice += 1) {
    const atual = argv[indice];
    if (!atual.startsWith('--')) continue;
    const chave = atual.slice(2);
    const valor = argv[indice + 1];
    if (valor === undefined || valor.startsWith('--')) {
      argumentos.set(chave, true);
      continue;
    }
    argumentos.set(chave, valor);
    indice += 1;
  }
  return argumentos;
}

function encerrarComErro(mensagem) {
  console.error(`\n[ERRO] ${mensagem}\n`);
  process.exitCode = 1;
}

async function principal() {
  const argumentos = lerArgumentos(process.argv.slice(2));
  const email = String(argumentos.get('email') || '').trim();
  const senha = String(argumentos.get('senha') || '');
  const nome = String(argumentos.get('nome') || 'Administrador').trim();

  if (!email || !senha) {
    encerrarComErro(
      'Informe e-mail e senha.\n' +
        '        Exemplo: node scripts/admin/provisionar-administrador.mjs --email pessoa@dominio.com --senha "SenhaForte123!" --nome "Nome"'
    );
    return;
  }

  if (senha.length < 12 || senha.length > 128) {
    encerrarComErro('A senha precisa ter entre 12 e 128 caracteres, conforme a política do app.');
    return;
  }

  const registrador = {
    info() {},
    warn(mensagem) {
      console.warn(mensagem);
    },
    error(mensagem) {
      console.error(mensagem);
    }
  };

  const runtime = await createKairoRuntime({ logger: registrador, relocateLegacy: false });

  try {
    const { db, services } = runtime;

    const existente = db.get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]);

    // O ator da auditoria é um administrador ativo já existente; quando a base
    // ainda não possui nenhum, o registro fica sem ator, o que a auditoria aceita.
    const administradorAtual = db.get(
      "SELECT id FROM users WHERE role = 'administrador' AND is_active = 1 ORDER BY id ASC LIMIT 1"
    );
    const ator = { id: administradorAtual ? administradorAtual.id : null };

    let resultado;
    let operacao;

    if (existente) {
      operacao = 'promovido';
      resultado = await services.auth.updateUser(
        existente.id,
        {
          name: existente.name || nome,
          role: PERFIL_ADMINISTRADOR,
          plan: PLANO_COMPLETO,
          password: senha,
          is_active: true
        },
        ator,
        {}
      );
    } else {
      operacao = 'criado';
      resultado = await services.auth.createUser(
        {
          name: nome,
          email,
          password: senha,
          role: PERFIL_ADMINISTRADOR,
          plan: PLANO_COMPLETO
        },
        ator,
        {}
      );
    }

    const confirmacao = db.get(
      'SELECT id, name, email, role, plan, is_active FROM users WHERE id = ?',
      [resultado.id]
    );

    console.log('\n============================================================');
    console.log(`  [SUCESSO] Administrador ${operacao} com acesso completo.`);
    console.log('============================================================');
    console.log(`  id       : ${confirmacao.id}`);
    console.log(`  nome     : ${confirmacao.name}`);
    console.log(`  e-mail   : ${confirmacao.email}`);
    console.log(`  perfil   : ${confirmacao.role}`);
    console.log(`  plano    : ${confirmacao.plan}`);
    console.log(`  ativo    : ${confirmacao.is_active === 1 ? 'sim' : 'nao'}`);
    console.log('============================================================\n');

    if (confirmacao.role !== PERFIL_ADMINISTRADOR || confirmacao.plan !== PLANO_COMPLETO) {
      encerrarComErro('A conta não ficou com perfil administrador e plano pro. Verifique a base.');
    }
  } catch (erro) {
    encerrarComErro(erro?.message || String(erro));
  } finally {
    runtime.close();
  }
}

await principal();
