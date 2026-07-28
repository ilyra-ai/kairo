// ============================================================================
// Kairo — Semente automática do administrador padrão na inicialização
// ----------------------------------------------------------------------------
// Garante que, a cada boot, exista uma conta administradora ativa e com acesso
// integral (admin@admin.com / Admin123# por padrão), criando-a quando faltar e
// ativando/promovendo quando necessário — de forma idempotente.
//
// A credencial exercitada aqui é lida de loadEnvironment(), não redigitada: o
// que o README publica como acesso padrão é exatamente o que a configuração
// entrega, e alterar um sem o outro derruba a suíte.
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { test } from 'node:test';
import {
  ensureCoreSchema,
  ensureUserWorkspace,
  openSqliteClient
} from '../../src/server/database/index.js';
import { loadEnvironment } from '../../src/server/config/env.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';

const SESSION_SECRET = 'segredo-seed-admin-com-mais-de-trinta-e-dois-bytes-2026';
const PADRAO = loadEnvironment({}).seedAdmin;
const SEED = { name: PADRAO.name, email: PADRAO.email, password: PADRAO.password };

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-seed-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const authService = createAuthService({
    db,
    sessionSecret: SESSION_SECRET,
    sessionTtlMs: 60 * 60 * 1000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, authService };
}

test('cria e ativa o administrador padrão em base vazia (senha válida)', async (t) => {
  const { db, authService } = criarContexto(t);
  const resultado = await authService.ensureSeedAdmin(SEED);

  assert.equal(resultado.created, true);
  assert.equal(resultado.activated, true);
  assert.equal(resultado.user.role, 'administrador');
  assert.equal(resultado.user.is_active, true);

  const persistido = db.get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', [SEED.email]);
  assert.equal(persistido.role, 'administrador');
  assert.equal(Number(persistido.is_active), 1);
  // A senha padrão precisa autenticar de verdade (bcrypt).
  assert.equal(await bcrypt.compare(SEED.password, persistido.password_hash), true);
  // Política imutável: 8 caracteres são suficientes.
  assert.equal(SEED.password.length >= 8, true);
});

test('o acesso padrão publicado no README é o que a configuração entrega', () => {
  // Amarra a documentação à configuração. O README instrui a entrar com
  // admin@admin.com / Admin123#; se alguém trocar o padrão sem atualizar o
  // texto, este teste cai antes de a instrução virar mentira para o usuário.
  assert.equal(PADRAO.email, 'admin@admin.com');
  assert.equal(PADRAO.password, 'Admin123#');
  assert.equal(PADRAO.name, 'Administrador');
  assert.equal(PADRAO.enabled, true);

  const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.match(readme, /`admin@admin\.com`/);
  assert.match(readme, /`Admin123#`/);

  // As variáveis de escape precisam continuar documentadas: sem elas, quem
  // publica o Kairo fora da máquina pessoal fica sem caminho para trocar ou
  // desligar a credencial versionada.
  for (const chave of [
    'SEED_ADMIN_EMAIL',
    'SEED_ADMIN_PASSWORD',
    'SEED_ADMIN_NAME',
    'SEED_ADMIN_ENABLED'
  ]) {
    assert.match(readme, new RegExp(chave), `${chave} precisa estar no README`);
  }
});

test('as variáveis de ambiente sobrescrevem o padrão versionado', () => {
  // O caminho de escape só serve se funcionar de verdade.
  const trocado = loadEnvironment({}).seedAdmin;
  assert.equal(trocado.password, 'Admin123#');

  const anterior = {
    email: process.env.SEED_ADMIN_EMAIL,
    senha: process.env.SEED_ADMIN_PASSWORD,
    ligado: process.env.SEED_ADMIN_ENABLED
  };
  try {
    process.env.SEED_ADMIN_EMAIL = 'dono@exemplo.com';
    process.env.SEED_ADMIN_PASSWORD = 'outra-senha-bem-forte-2026';
    const custom = loadEnvironment({}).seedAdmin;
    assert.equal(custom.email, 'dono@exemplo.com');
    assert.equal(custom.password, 'outra-senha-bem-forte-2026');

    process.env.SEED_ADMIN_ENABLED = 'false';
    assert.equal(loadEnvironment({}).seedAdmin.enabled, false);
  } finally {
    for (const [chave, valor] of [
      ['SEED_ADMIN_EMAIL', anterior.email],
      ['SEED_ADMIN_PASSWORD', anterior.senha],
      ['SEED_ADMIN_ENABLED', anterior.ligado]
    ]) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
  }
  assert.equal(loadEnvironment({}).seedAdmin.password, 'Admin123#');
});

test('é idempotente: chamar de novo não duplica nem quebra', async (t) => {
  const { db, authService } = criarContexto(t);
  await authService.ensureSeedAdmin(SEED);
  const segunda = await authService.ensureSeedAdmin(SEED);

  assert.equal(segunda.created, false);
  assert.equal(segunda.activated, true);
  const total = Number(
    db.get('SELECT COUNT(*) AS total FROM users WHERE email = ? COLLATE NOCASE', [SEED.email]).total
  );
  assert.equal(total, 1);
});

test('reativa e promove um administrador desativado/rebaixado', async (t) => {
  const { db, authService } = criarContexto(t);
  await authService.ensureSeedAdmin(SEED);

  // Simula conta desativada e rebaixada.
  db.run("UPDATE users SET is_active = 0, role = 'usuario' WHERE email = ? COLLATE NOCASE", [
    SEED.email
  ]);

  const resultado = await authService.ensureSeedAdmin(SEED);
  assert.equal(resultado.created, false);
  assert.equal(resultado.activated, true);
  assert.equal(resultado.user.role, 'administrador');

  const persistido = db.get('SELECT role, is_active FROM users WHERE email = ? COLLATE NOCASE', [
    SEED.email
  ]);
  assert.equal(persistido.role, 'administrador');
  assert.equal(Number(persistido.is_active), 1);
});

test('não sobrescreve a senha de um admin já existente (respeita troca do usuário)', async (t) => {
  const { db, authService } = criarContexto(t);
  await authService.ensureSeedAdmin(SEED);

  // Usuário troca a própria senha depois.
  const novoHash = await bcrypt.hash('nova-senha-do-admin', 12);
  db.run('UPDATE users SET password_hash = ? WHERE email = ? COLLATE NOCASE', [
    novoHash,
    SEED.email
  ]);

  await authService.ensureSeedAdmin(SEED);
  const persistido = db.get('SELECT password_hash FROM users WHERE email = ? COLLATE NOCASE', [
    SEED.email
  ]);
  // A senha trocada permanece; o seed não a reverte para o padrão.
  assert.equal(await bcrypt.compare('nova-senha-do-admin', persistido.password_hash), true);
  assert.equal(await bcrypt.compare(SEED.password, persistido.password_hash), false);
});
