// ============================================================================
//  Kairo — Módulo de Autenticação e Gestão de Usuários/Perfis
//  Auth real com bcrypt (hash de senha) + JWT (sessão via cookie httpOnly).
//  Perfis: administrador | free | plus | pro.
//  Seed do administrador total: admin@admin.com / admin123.
// ============================================================================

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const TOKEN_COOKIE = 'kairo_token';
const TOKEN_TTL = '7d';
const ROLES = ['administrador', 'free', 'plus', 'pro'];

// ---------------------------------------------------------------------------
// Inicialização: tabelas, secret JWT e seed do admin
// ---------------------------------------------------------------------------
export async function ensureAuthSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'free',
      plan TEXT NOT NULL DEFAULT 'free',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Secret JWT persistente (gerado uma vez; mantém sessões válidas entre restarts)
  let secretRow = await db.get('SELECT value FROM app_config WHERE key = ?', ['jwt_secret']);
  if (!secretRow) {
    const secret = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
    await db.run('INSERT INTO app_config (key, value) VALUES (?, ?)', ['jwt_secret', secret]);
    secretRow = { value: secret };
  }

  // Seed do administrador total
  const admin = await db.get('SELECT id FROM users WHERE email = ?', ['admin@admin.com']);
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.run(
      'INSERT INTO users (name, email, password_hash, role, plan) VALUES (?, ?, ?, ?, ?)',
      ['Administrador', 'admin@admin.com', hash, 'administrador', 'administrador']
    );
    console.log('Usuário administrador criado: admin@admin.com / admin123');
  }

  return secretRow.value;
}

async function getSecret(db) {
  const row = await db.get('SELECT value FROM app_config WHERE key = ?', ['jwt_secret']);
  return row ? row.value : (process.env.JWT_SECRET || 'kairo-dev-secret');
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, plan: u.plan, is_active: u.is_active };
}

// ---------------------------------------------------------------------------
// Registro / Login / Logout
// ---------------------------------------------------------------------------
export async function register(db, { name, email, password }) {
  if (!name || !email || !password) throw new Error('Nome, e-mail e senha são obrigatórios.');
  if (password.length < 6) throw new Error('A senha deve ter ao menos 6 caracteres.');

  const exists = await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (exists) throw new Error('Já existe uma conta com este e-mail.');

  const hash = bcrypt.hashSync(password, 10);
  // Todo novo usuário entra como Free (perfil + plano Free)
  const result = await db.run(
    'INSERT INTO users (name, email, password_hash, role, plan) VALUES (?, ?, ?, ?, ?)',
    [name, email.toLowerCase(), hash, 'free', 'free']
  );
  const user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
  const token = await issueToken(db, user);
  return { user: publicUser(user), token };
}

export async function login(db, { email, password }) {
  if (!email || !password) throw new Error('E-mail e senha são obrigatórios.');
  const user = await db.get('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]);
  if (!user) throw new Error('E-mail ou senha inválidos.');
  if (!user.is_active) throw new Error('Conta desativada. Contate o administrador.');

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) throw new Error('E-mail ou senha inválidos.');

  const token = await issueToken(db, user);
  return { user: publicUser(user), token };
}

async function issueToken(db, user) {
  const secret = await getSecret(db);
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, plan: user.plan },
    secret,
    { expiresIn: TOKEN_TTL }
  );
}

export function cookieName() { return TOKEN_COOKIE; }

// ---------------------------------------------------------------------------
// Middlewares de proteção
// ---------------------------------------------------------------------------
export function makeAuthMiddleware(db) {
  return async function requireAuth(req, res, next) {
    try {
      const token = req.cookies ? req.cookies[TOKEN_COOKIE] : null;
      if (!token) return res.status(401).json({ error: 'Não autenticado.' });
      const secret = await getSecret(db);
      const payload = jwt.verify(token, secret);
      const user = await db.get('SELECT * FROM users WHERE id = ?', [payload.id]);
      if (!user || !user.is_active) return res.status(401).json({ error: 'Sessão inválida.' });
      req.user = publicUser(user);
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Sessão expirada ou inválida.' });
    }
  };
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'administrador') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }
  next();
}

// ---------------------------------------------------------------------------
// CRUD de usuários (somente admin)
// ---------------------------------------------------------------------------
export async function listUsers(db) {
  const rows = await db.all('SELECT id, name, email, role, plan, is_active, created_at FROM users ORDER BY id ASC');
  return rows;
}

export async function createUser(db, { name, email, password, role, plan }) {
  if (!name || !email || !password) throw new Error('Nome, e-mail e senha são obrigatórios.');
  const exists = await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (exists) throw new Error('Já existe uma conta com este e-mail.');
  const r = ROLES.includes(role) ? role : 'free';
  const p = plan || (r === 'administrador' ? 'pro' : r === 'free' ? 'free' : r);
  const hash = bcrypt.hashSync(password, 10);
  const result = await db.run(
    'INSERT INTO users (name, email, password_hash, role, plan) VALUES (?, ?, ?, ?, ?)',
    [name, email.toLowerCase(), hash, r, p]
  );
  return await db.get('SELECT id, name, email, role, plan, is_active FROM users WHERE id = ?', [result.lastID]);
}

export async function updateUser(db, id, { name, email, role, plan, is_active, password }) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) throw new Error('Usuário não encontrado.');

  const newName = name !== undefined ? name : user.name;
  const newEmail = email !== undefined ? email.toLowerCase() : user.email;
  const newRole = role !== undefined && ROLES.includes(role) ? role : user.role;
  const newPlan = plan !== undefined ? plan : user.plan;
  const newActive = is_active !== undefined ? (is_active ? 1 : 0) : user.is_active;

  // Protege o último administrador de ser rebaixado/desativado
  if ((user.role === 'administrador') && (newRole !== 'administrador' || newActive === 0)) {
    const admins = await db.get("SELECT COUNT(*) as c FROM users WHERE role = 'administrador' AND is_active = 1");
    if (admins.c <= 1) throw new Error('Não é possível rebaixar/desativar o único administrador.');
  }

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  }

  await db.run(
    'UPDATE users SET name = ?, email = ?, role = ?, plan = ?, is_active = ? WHERE id = ?',
    [newName, newEmail, newRole, newPlan, newActive, id]
  );
  return await db.get('SELECT id, name, email, role, plan, is_active FROM users WHERE id = ?', [id]);
}

export async function deleteUser(db, id) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) throw new Error('Usuário não encontrado.');
  if (user.role === 'administrador') {
    const admins = await db.get("SELECT COUNT(*) as c FROM users WHERE role = 'administrador' AND is_active = 1");
    if (admins.c <= 1) throw new Error('Não é possível excluir o único administrador.');
  }
  await db.run('DELETE FROM users WHERE id = ?', [id]);
}

export { ROLES };
