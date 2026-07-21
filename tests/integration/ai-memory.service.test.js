// ============================================================================
// Kairo — Integração da memória de IA criptografada e privada (Tarefa 28)
// ----------------------------------------------------------------------------
// Prova: isolamento entre usuários, conteúdo ilegível no banco/backup, chave
// ausente, rotação de chave, item adulterado, exclusão criptográfica, expiração
// e administração apenas por metadados (sem leitura de conteúdo).
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { openSqliteClient } from '../../src/server/database/index.js';
import { ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { createAiMemoryService } from '../../src/server/modules/ai/ai-memory.service.js';

const KEK = randomBytes(32);

function criarContexto(t, { key = KEK } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-memoria-'));
  const dbPath = path.join(directory, 'database.sqlite');
  const db = openSqliteClient(dbPath);
  ensureAuthSchema(db);
  db.run(
    `INSERT INTO users (name, email, password_hash, role, plan)
     VALUES ('A', 'a@k.local', 'h', 'usuario', 'free'), ('B', 'b@k.local', 'h', 'usuario', 'free')`
  );
  const service = createAiMemoryService({ db, encryptionKey: key });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, dbPath, service };
}

test('memória desativada bloqueia gravação; ativar habilita', async (t) => {
  const { service } = criarContexto(t);
  assert.throws(
    () =>
      service.remember(1, {
        type: 'preferencia',
        purpose: 'personalizacao',
        content: 'gosto de foco de 50min'
      }),
    (e) => e.code === 'MEMORIA_DESATIVADA'
  );
  service.enable(1);
  const r = service.remember(1, {
    type: 'preferencia',
    purpose: 'personalizacao',
    content: 'gosto de foco de 50min'
  });
  assert.equal(r.stored, true);
});

test('isolamento: usuário A não recupera memória do usuário B', async (t) => {
  const { service } = criarContexto(t);
  service.enable(1);
  service.enable(2);
  service.remember(1, { type: 'fato', purpose: 'personalizacao', content: 'moro em Curitiba' });
  service.remember(2, { type: 'fato', purpose: 'personalizacao', content: 'moro em Recife' });

  const deA = service.retrieve(1, { purpose: 'personalizacao' });
  assert.equal(deA.items.length, 1);
  assert.match(deA.items[0].content, /Curitiba/);
  assert.ok(!deA.items.some((i) => /Recife/.test(i.content)));

  // O próprio usuário vê o seu conteúdo (listOwn); nunca o do outro.
  assert.equal(service.listOwn(1).length, 1);
  assert.match(service.listOwn(1)[0].content, /Curitiba/);
});

test('conteúdo não é legível diretamente no banco (nem em cópia/backup)', async (t) => {
  const { db, dbPath, service } = criarContexto(t);
  service.enable(1);
  service.remember(1, {
    type: 'fato',
    purpose: 'personalizacao',
    content: 'MINHA-FRASE-SECRETA-123'
  });

  // Lê o ciphertext cru direto da tabela: não pode conter o texto claro.
  const linha = db.get('SELECT ciphertext FROM ai_memory_items WHERE user_id = 1');
  assert.ok(!linha.ciphertext.includes('MINHA-FRASE-SECRETA-123'));

  // Copia o arquivo do banco (simula backup) e varre os bytes: sem texto claro.
  const copia = `${dbPath}.bak`;
  fs.copyFileSync(dbPath, copia);
  const bytes = fs.readFileSync(copia, 'latin1');
  assert.ok(!bytes.includes('MINHA-FRASE-SECRETA-123'), 'texto claro não pode aparecer no backup');
  fs.rmSync(copia);
});

test('sem a KEK correta, o conteúdo não pode ser descriptografado', async (t) => {
  const { db, service } = criarContexto(t);
  service.enable(1);
  service.remember(1, { type: 'fato', purpose: 'personalizacao', content: 'segredo do usuario' });

  // Outro serviço com KEK diferente não consegue ler (DEK não desembrulha).
  const outro = createAiMemoryService({ db, encryptionKey: randomBytes(32) });
  const r = outro.retrieve(1, { purpose: 'personalizacao' });
  assert.equal(r.items.length, 0, 'chave errada não pode revelar conteúdo');
});

test('item adulterado no banco é ignorado com segurança (autenticação GCM)', async (t) => {
  const { db, service } = criarContexto(t);
  service.enable(1);
  service.remember(1, { type: 'fato', purpose: 'personalizacao', content: 'conteudo integro' });

  // Adultera o ciphertext (quebra a tag GCM).
  const item = db.get('SELECT id, ciphertext FROM ai_memory_items WHERE user_id = 1');
  db.run('UPDATE ai_memory_items SET ciphertext = ? WHERE id = ?', [
    item.ciphertext + 'AAAA',
    item.id
  ]);
  const r = service.retrieve(1, { purpose: 'personalizacao' });
  assert.equal(r.items.length, 0, 'item adulterado não pode ser retornado');
});

test('rotação de chave recripta itens e mantém a leitura pelo dono', async (t) => {
  const { db, service } = criarContexto(t);
  service.enable(1);
  service.remember(1, { type: 'fato', purpose: 'personalizacao', content: 'valor persistente' });
  const versaoAntes = db.get(
    'SELECT key_version FROM ai_memory_items WHERE user_id = 1'
  ).key_version;

  const rot = service.rotateKey(1);
  assert.equal(rot.rotated, true);
  assert.ok(rot.to_version > rot.from_version);

  const versaoDepois = db.get(
    'SELECT key_version FROM ai_memory_items WHERE user_id = 1'
  ).key_version;
  assert.ok(versaoDepois > versaoAntes);
  // Conteúdo continua legível pelo dono após a rotação.
  assert.match(service.listOwn(1)[0].content, /valor persistente/);
});

test('limpeza remove itens e gera comprovante; contexto não reaparece', async (t) => {
  const { service } = criarContexto(t);
  service.enable(1);
  service.remember(1, { type: 'fato', purpose: 'personalizacao', content: 'lembrar disso' });
  const res = service.purge(1, { scope: 'total' });
  assert.equal(res.deleted_items, 1);
  assert.match(res.receipt, /^[a-f0-9]{64}$/);
  assert.equal(service.retrieve(1, {}).items.length, 0);
  assert.equal(service.listOwn(1).length, 0);
});

test('memória expirada deixa de ser recuperada', async (t) => {
  const { db, service } = criarContexto(t);
  service.enable(1);
  service.remember(1, { type: 'episodica', purpose: 'contexto_sessao', content: 'temporario' });
  // Força expiração no passado.
  db.run("UPDATE ai_memory_items SET expires_at = datetime('now','-1 day') WHERE user_id = 1");
  const r = service.retrieve(1, {});
  assert.equal(r.items.length, 0);
  assert.equal(db.get('SELECT COUNT(*) AS t FROM ai_memory_items WHERE user_id = 1').t, 0);
});

test('conteúdo proibido (segredos) é recusado', async (t) => {
  const { service } = criarContexto(t);
  service.enable(1);
  assert.throws(
    () =>
      service.remember(1, {
        type: 'fato',
        purpose: 'personalizacao',
        content: 'minha senha = 12345678'
      }),
    (e) => e.code === 'CONTEUDO_PROIBIDO'
  );
});

test('administração vê apenas metadados, nunca conteúdo', async (t) => {
  const { service } = criarContexto(t);
  service.enable(1);
  service.remember(1, {
    type: 'fato',
    purpose: 'personalizacao',
    content: 'conteudo privado do usuario'
  });

  const stats = service.adminStats(1);
  const serial = JSON.stringify(stats);
  assert.ok(!serial.includes('conteudo privado do usuario'), 'admin não pode ver conteúdo');
  assert.ok(Array.isArray(stats.by_type));
  assert.equal(typeof stats.enabled, 'boolean');

  const usuarios = service.adminListUsers();
  assert.ok(usuarios.every((u) => !JSON.stringify(u).includes('conteudo privado')));
});

test('dashboard de memória: summary, top10, timeseries e postura sem conteúdo', async (t) => {
  const { service } = criarContexto(t);
  service.enable(1);
  service.enable(2);
  service.remember(1, { type: 'fato', purpose: 'personalizacao', content: 'AAA conteudo do A' });
  service.remember(1, {
    type: 'preferencia',
    purpose: 'personalizacao',
    content: 'BBB outra do A'
  });
  service.remember(2, { type: 'fato', purpose: 'personalizacao', content: 'CCC conteudo do B' });

  const resumo = service.adminSummary();
  assert.equal(resumo.active_users, 2);
  assert.equal(resumo.total_items, 3);
  assert.ok(resumo.logical_bytes > 0);
  assert.ok(Array.isArray(resumo.by_type));
  assert.ok(!JSON.stringify(resumo).includes('conteudo do A'), 'summary sem conteúdo');

  const top = service.adminTop(10);
  assert.ok(top.length >= 2);
  // Top confere: usuário 1 tem 2 itens, usuário 2 tem 1.
  const u1 = top.find((r) => r.user_id === 1);
  assert.equal(Number(u1.items), 2);
  assert.ok(!JSON.stringify(top).includes('conteudo'), 'top10 sem coluna textual da memória');

  const serie = service.adminTimeseries({ granularity: 'day' });
  assert.ok(Array.isArray(serie.growth));
  assert.ok(serie.growth.reduce((s, p) => s + Number(p.total), 0) >= 3);

  const postura = service.adminPrivacyPosture();
  assert.ok(postura.key_versions >= 2);
  assert.match(postura.encryption, /AES-256-GCM/);
});
