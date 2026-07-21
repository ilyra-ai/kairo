// ============================================================================
// Kairo — Serviço de autenticação, sessões revogáveis e gestão de usuários
// ============================================================================

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  conflict,
  forbidden,
  notFound,
  unauthorized,
  unprocessable
} from '../../shared/http-error.js';

const ROLE_ADMIN = 'administrador';
const ROLE_USER = 'usuario';
const PASSWORD_ROUNDS = 12;
const TOKEN_ISSUER = 'kairo';
const TOKEN_AUDIENCE = 'kairo-web';

function isoAfter(milliseconds) {
  return new Date(Date.now() + milliseconds).toISOString();
}

function timestampMilliseconds(value) {
  if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  return new Date(normalized).getTime();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    plan: user.plan,
    is_active: Boolean(user.is_active),
    created_at: user.created_at
  };
}

function hmacFingerprint(secret, value) {
  if (!value) return null;
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const allowed = {};
  for (const key of ['campos', 'motivo', 'roleAnterior', 'roleNovo', 'planAnterior', 'planNovo']) {
    if (metadata[key] !== undefined) allowed[key] = metadata[key];
  }
  return Object.keys(allowed).length > 0 ? JSON.stringify(allowed) : null;
}

function tableExists(db, tableName) {
  return Boolean(
    db.get("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName])
  );
}

function addMissingUserColumns(db) {
  const columns = new Set(db.all('PRAGMA table_info(users)').map((column) => column.name));
  const additions = [
    ['token_version', 'INTEGER NOT NULL DEFAULT 0'],
    ['updated_at', 'DATETIME DEFAULT NULL']
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  }
  db.run('UPDATE users SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)');
}

export function ensureAuthSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '${ROLE_USER}' CHECK (role IN ('${ROLE_ADMIN}', '${ROLE_USER}')),
      plan TEXT NOT NULL DEFAULT 'free',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  addMissingUserColumns(db);

  db.transaction(() => {
    db.run("UPDATE users SET plan = role WHERE role IN ('free', 'plus', 'pro')");
    db.run("UPDATE users SET plan = 'pro' WHERE role = 'administrador' AND plan = 'administrador'");
    db.run("UPDATE users SET role = 'usuario' WHERE role IN ('free', 'plus', 'pro')");
  });

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_version INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reauthenticated_at DATETIME DEFAULT NULL,
      revoked_at DATETIME DEFAULT NULL,
      user_agent_hash TEXT DEFAULT NULL,
      ip_hash TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER DEFAULT NULL,
      target_user_id INTEGER DEFAULT NULL,
      action TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('sucesso', 'falha', 'negado')),
      request_id TEXT DEFAULT NULL,
      ip_hash TEXT DEFAULT NULL,
      user_agent_hash TEXT DEFAULT NULL,
      metadata_json TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL,
      FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
      ON auth_sessions (user_id, revoked_at, expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_events_actor_date
      ON audit_events (actor_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_events_action_date
      ON audit_events (action, created_at);
  `);

  const hasAppConfig = db.get(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'app_config'"
  );
  if (hasAppConfig) db.run("DELETE FROM app_config WHERE key = 'jwt_secret'");
}

export function createAuthService(options) {
  const {
    db,
    sessionSecret,
    sessionTtlMs = 7 * 24 * 60 * 60 * 1000,
    recentAuthTtlMs = 10 * 60 * 1000,
    onUserCreated = () => {},
    allowFirstUserBootstrap = true
  } = options;

  if (!db) throw new Error('O banco é obrigatório para o serviço de autenticação.');
  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('O segredo de sessão precisa ter pelo menos 32 bytes.');
  }

  function audit({ action, result, actorUserId, targetUserId, request, metadata }) {
    db.run(
      `INSERT INTO audit_events
         (actor_user_id, target_user_id, action, result, request_id, ip_hash, user_agent_hash, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorUserId ?? null,
        targetUserId ?? null,
        action,
        result,
        request?.requestId ?? null,
        hmacFingerprint(sessionSecret, request?.ip),
        hmacFingerprint(sessionSecret, request?.headers?.['user-agent']),
        safeMetadata(metadata)
      ]
    );
  }

  function csrfForSession(sessionId) {
    return crypto
      .createHmac('sha256', sessionSecret)
      .update(`csrf:${sessionId}`)
      .digest('base64url');
  }

  function verifyCsrf(sessionId, providedToken) {
    if (!providedToken || typeof providedToken !== 'string') return false;
    const expected = csrfForSession(sessionId);
    const received = Buffer.from(providedToken);
    const target = Buffer.from(expected);
    return received.length === target.length && crypto.timingSafeEqual(received, target);
  }

  function issueSession(user, request) {
    const sessionId = crypto.randomUUID();
    const expiresAt = isoAfter(sessionTtlMs);
    db.run(
      `INSERT INTO auth_sessions
         (id, user_id, token_version, expires_at, user_agent_hash, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        user.id,
        user.token_version,
        expiresAt,
        hmacFingerprint(sessionSecret, request?.headers?.['user-agent']),
        hmacFingerprint(sessionSecret, request?.ip)
      ]
    );

    const token = jwt.sign(
      { sub: String(user.id), sid: sessionId, ver: Number(user.token_version) },
      sessionSecret,
      {
        algorithm: 'HS512',
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        expiresIn: Math.floor(sessionTtlMs / 1000),
        jwtid: crypto.randomUUID()
      }
    );

    return { token, csrfToken: csrfForSession(sessionId), expiresAt };
  }

  async function register(input, request = {}) {
    const passwordHash = await bcrypt.hash(input.password, PASSWORD_ROUNDS);
    let user;
    let isFirstUser = false;

    try {
      user = db.transaction(() => {
        const totalUsers = Number(db.get('SELECT COUNT(*) AS total FROM users').total);
        isFirstUser = totalUsers === 0;
        if (isFirstUser && !allowFirstUserBootstrap) {
          throw forbidden(
            'A configuração inicial precisa ser concluída localmente.',
            'BOOTSTRAP_RESTRITO'
          );
        }

        const role = isFirstUser ? ROLE_ADMIN : ROLE_USER;
        const plan = isFirstUser ? 'pro' : 'free';
        const result = db.run(
          `INSERT INTO users (name, email, password_hash, role, plan)
           VALUES (?, ?, ?, ?, ?)`,
          [input.name, input.email, passwordHash, role, plan]
        );
        return db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
      });
    } catch (error) {
      if (String(error?.code || '').includes('SQLITE_CONSTRAINT_UNIQUE')) {
        throw conflict('Já existe uma conta com este e-mail.', 'EMAIL_JA_CADASTRADO');
      }
      throw error;
    }

    onUserCreated(user, { isFirstUser });

    const session = issueSession(user, request);
    audit({
      action: isFirstUser ? 'auth.bootstrap' : 'auth.register',
      result: 'sucesso',
      actorUserId: user.id,
      targetUserId: user.id,
      request
    });
    return { user: publicUser(user), ...session, isFirstUser };
  }

  async function login(input, request = {}) {
    const user = db.get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', [input.email]);
    const dummyHash = '$2a$12$4hX6U9QG4y8hk1zsdglx0O4pX0hKgEuVxh4BfVTB0d6XgIRn2w2pK';
    const passwordMatches = await bcrypt.compare(input.password, user?.password_hash || dummyHash);

    if (!user || !passwordMatches) {
      audit({
        action: 'auth.login',
        result: 'falha',
        request,
        metadata: { motivo: 'credencial_invalida' }
      });
      throw unauthorized('E-mail ou senha inválidos.', 'CREDENCIAIS_INVALIDAS');
    }
    if (!user.is_active) {
      audit({
        action: 'auth.login',
        result: 'negado',
        targetUserId: user.id,
        request,
        metadata: { motivo: 'conta_inativa' }
      });
      throw forbidden('Esta conta está desativada.', 'CONTA_DESATIVADA');
    }

    if (bcrypt.getRounds(user.password_hash) < PASSWORD_ROUNDS) {
      const upgradedHash = await bcrypt.hash(input.password, PASSWORD_ROUNDS);
      db.run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
        upgradedHash,
        user.id
      ]);
    }

    onUserCreated(user, { isFirstUser: false, isLogin: true });
    const session = issueSession(user, request);
    audit({
      action: 'auth.login',
      result: 'sucesso',
      actorUserId: user.id,
      targetUserId: user.id,
      request
    });
    return { user: publicUser(user), ...session };
  }

  function authenticate(token) {
    if (!token) throw unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, sessionSecret, {
        algorithms: ['HS512'],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE
      });
    } catch {
      throw unauthorized('A sessão expirou ou é inválida.', 'SESSAO_INVALIDA');
    }

    const session = db.get(
      `SELECT s.*, u.name, u.email, u.role, u.plan, u.is_active, u.created_at,
              u.token_version AS current_token_version
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.user_id = ?`,
      [payload.sid, Number(payload.sub)]
    );
    const expiresAt = timestampMilliseconds(session?.expires_at);

    if (
      !session ||
      session.revoked_at ||
      !session.is_active ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      Number(session.token_version) !== Number(session.current_token_version) ||
      Number(payload.ver) !== Number(session.current_token_version)
    ) {
      throw unauthorized('A sessão expirou ou foi revogada.', 'SESSAO_REVOGADA');
    }

    db.run('UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [session.id]);
    return {
      user: publicUser({ ...session, id: session.user_id }),
      session: {
        id: session.id,
        expiresAt: session.expires_at,
        reauthenticatedAt: session.reauthenticated_at
      }
    };
  }

  function logout(sessionId, request = {}, actorUserId) {
    if (sessionId) {
      db.run(
        'UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL',
        [sessionId]
      );
    }
    audit({
      action: 'auth.logout',
      result: 'sucesso',
      actorUserId,
      targetUserId: actorUserId,
      request
    });
  }

  async function reauthenticate(userId, sessionId, password, request = {}) {
    const user = db.get('SELECT * FROM users WHERE id = ? AND is_active = 1', [userId]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      audit({
        action: 'auth.reauthenticate',
        result: 'falha',
        actorUserId: userId,
        targetUserId: userId,
        request
      });
      throw unauthorized('A senha informada não confere.', 'REAUTENTICACAO_INVALIDA');
    }
    db.run(
      'UPDATE auth_sessions SET reauthenticated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      [sessionId, userId]
    );
    audit({
      action: 'auth.reauthenticate',
      result: 'sucesso',
      actorUserId: userId,
      targetUserId: userId,
      request
    });
    return { validUntil: isoAfter(recentAuthTtlMs) };
  }

  /**
   * Troca de senha realizada pelo próprio usuário autenticado.
   *
   * A senha atual é conferida com bcrypt antes de qualquer gravação. Ao trocar,
   * o `token_version` é incrementado e todas as demais sessões do usuário são
   * revogadas, de modo que sessões abertas em outros dispositivos deixam de
   * valer imediatamente; a sessão atual permanece ativa e é marcada como
   * reautenticada agora.
   */
  async function changeOwnPassword(user, { currentPassword, newPassword }, session, request = {}) {
    const persistido = db.get('SELECT * FROM users WHERE id = ? AND is_active = 1', [user.id]);
    if (!persistido || !(await bcrypt.compare(currentPassword, persistido.password_hash))) {
      audit({
        action: 'auth.password.change',
        result: 'falha',
        actorUserId: user.id,
        targetUserId: user.id,
        request
      });
      throw unauthorized('A senha atual não confere.', 'SENHA_ATUAL_INVALIDA');
    }

    const novoHash = await bcrypt.hash(newPassword, PASSWORD_ROUNDS);
    const sessaoAtual = session?.id ?? null;

    db.transaction(() => {
      db.run(
        `UPDATE users
            SET password_hash = ?,
                token_version = token_version + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [novoHash, persistido.id]
      );
      db.run(
        `UPDATE auth_sessions
            SET revoked_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?`,
        [persistido.id, sessaoAtual]
      );
      if (sessaoAtual) {
        const versaoAtual = Number(
          db.get('SELECT token_version FROM users WHERE id = ?', [persistido.id]).token_version
        );
        db.run(
          `UPDATE auth_sessions
              SET reauthenticated_at = CURRENT_TIMESTAMP,
                  token_version = ?
            WHERE id = ? AND user_id = ?`,
          [versaoAtual, sessaoAtual, persistido.id]
        );
      }
    });

    audit({
      action: 'auth.password.change',
      result: 'sucesso',
      actorUserId: user.id,
      targetUserId: user.id,
      request
    });

    return { changed: true };
  }

  function hasRecentAuthentication(session) {
    if (!session?.reauthenticatedAt) return false;
    const reauthenticatedAt = timestampMilliseconds(session.reauthenticatedAt);
    if (!Number.isFinite(reauthenticatedAt)) return false;
    const elapsed = Date.now() - reauthenticatedAt;
    return elapsed >= 0 && elapsed <= recentAuthTtlMs;
  }

  function bootstrapRequired() {
    return Number(db.get('SELECT COUNT(*) AS total FROM users').total) === 0;
  }

  /**
   * Semente automática de administrador executada a cada inicialização do app.
   * Garante que a conta administradora padrão exista, esteja ATIVA e com perfil
   * `administrador` (acesso integral). Em base vazia, cria a conta com a senha
   * informada e inicializa o domínio via `onUserCreated`. Em base já povoada,
   * apenas assegura papel administrador e ativação — sem sobrescrever a senha,
   * para não anular trocas de senha feitas pelo próprio administrador.
   *
   * A senha padrão respeita a política imutável (mínimo de 8 caracteres, sem
   * exigência de composição).
   */
  async function ensureSeedAdmin({ name = 'Administrador', email, password } = {}) {
    if (!email || !password) {
      throw new Error('A semente de administrador exige e-mail e senha.');
    }
    const existente = db.get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]);

    if (!existente) {
      const passwordHash = await bcrypt.hash(password, PASSWORD_ROUNDS);
      let isFirstUser = false;
      const criado = db.transaction(() => {
        isFirstUser = Number(db.get('SELECT COUNT(*) AS total FROM users').total) === 0;
        const result = db.run(
          `INSERT INTO users (name, email, password_hash, role, plan, is_active)
           VALUES (?, ?, ?, ?, 'pro', 1)`,
          [name, email, passwordHash, ROLE_ADMIN]
        );
        return db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
      });
      onUserCreated(criado, { isFirstUser });
      audit({
        action: 'auth.seed_admin.create',
        result: 'sucesso',
        actorUserId: criado.id,
        targetUserId: criado.id,
        metadata: { email }
      });
      return { user: publicUser(criado), created: true, activated: true };
    }

    // Já existe: garante papel administrador e ativação, sem tocar na senha.
    const precisaAtivar = Number(existente.is_active) !== 1;
    const precisaPromover = existente.role !== ROLE_ADMIN;
    if (precisaAtivar || precisaPromover) {
      db.run(
        `UPDATE users SET is_active = 1, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [ROLE_ADMIN, existente.id]
      );
      audit({
        action: 'auth.seed_admin.ensure',
        result: 'sucesso',
        actorUserId: existente.id,
        targetUserId: existente.id,
        metadata: { email, activated: precisaAtivar, promoted: precisaPromover }
      });
    }
    const atual = db.get('SELECT * FROM users WHERE id = ?', [existente.id]);
    return { user: publicUser(atual), created: false, activated: Number(atual.is_active) === 1 };
  }

  function listUsers() {
    return db
      .all(
        `SELECT id, name, email, role, plan, is_active, created_at, updated_at
       FROM users ORDER BY created_at ASC, id ASC`
      )
      .map(publicUser);
  }

  async function createUser(input, actor, request = {}) {
    const planExists = db.get('SELECT 1 AS found FROM plans WHERE key = ?', [input.plan]);
    if (!planExists) throw unprocessable('O plano informado não existe.', 'PLANO_INVALIDO');
    const passwordHash = await bcrypt.hash(input.password, PASSWORD_ROUNDS);
    let created;
    try {
      created = db.transaction(() => {
        const result = db.run(
          `INSERT INTO users (name, email, password_hash, role, plan)
           VALUES (?, ?, ?, ?, ?)`,
          [input.name, input.email, passwordHash, input.role, input.plan]
        );
        return db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
      });
    } catch (error) {
      if (String(error?.code || '').includes('SQLITE_CONSTRAINT_UNIQUE')) {
        throw conflict('Já existe uma conta com este e-mail.', 'EMAIL_JA_CADASTRADO');
      }
      throw error;
    }
    onUserCreated(created, { isFirstUser: false });
    audit({
      action: 'users.create',
      result: 'sucesso',
      actorUserId: actor.id,
      targetUserId: created.id,
      request
    });
    return publicUser(created);
  }

  async function updateUser(id, input, actor, request = {}) {
    const current = db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!current) throw notFound('Usuário não encontrado.', 'USUARIO_NAO_ENCONTRADO');
    if (
      input.plan !== undefined &&
      !db.get('SELECT 1 AS found FROM plans WHERE key = ?', [input.plan])
    ) {
      throw unprocessable('O plano informado não existe.', 'PLANO_INVALIDO');
    }

    const passwordHash = input.password ? await bcrypt.hash(input.password, PASSWORD_ROUNDS) : null;
    let updated;
    try {
      updated = db.transaction(() => {
        const nextRole = input.role ?? current.role;
        const nextPlan = input.plan ?? current.plan;
        const nextActive =
          input.is_active === undefined ? current.is_active : Number(input.is_active);
        if (current.role === ROLE_ADMIN && (nextRole !== ROLE_ADMIN || nextActive === 0)) {
          const administrators = Number(
            db.get(
              "SELECT COUNT(*) AS total FROM users WHERE role = 'administrador' AND is_active = 1"
            ).total
          );
          if (administrators <= 1) {
            throw conflict(
              'Não é possível desativar ou rebaixar o único administrador ativo.',
              'ULTIMO_ADMINISTRADOR'
            );
          }
        }

        db.run(
          `UPDATE users
           SET name = ?, email = ?, role = ?, plan = ?, is_active = ?,
               password_hash = COALESCE(?, password_hash),
               token_version = token_version + ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            input.name ?? current.name,
            input.email ?? current.email,
            nextRole,
            nextPlan,
            nextActive,
            passwordHash,
            passwordHash || nextRole !== current.role || nextActive !== current.is_active ? 1 : 0,
            id
          ]
        );

        if (
          nextRole !== ROLE_ADMIN &&
          (nextPlan !== current.plan || nextRole !== current.role) &&
          tableExists(db, 'profile_data')
        ) {
          const binauralAllowed = Boolean(
            db.get(
              `SELECT 1 AS allowed
             FROM plan_features
             WHERE plan_key = ? AND feature_key = 'binaural' AND enabled = 1`,
              [nextPlan]
            )
          );
          if (!binauralAllowed) {
            db.run(
              `UPDATE profile_data
               SET focus_sound = 'nenhum', updated_at = CURRENT_TIMESTAMP
               WHERE user_id = ? AND focus_sound = 'binaural'`,
              [id]
            );
          }
        }

        if (passwordHash || nextRole !== current.role || nextActive !== current.is_active) {
          db.run(
            'UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL',
            [id]
          );
        }
        return db.get('SELECT * FROM users WHERE id = ?', [id]);
      });
    } catch (error) {
      if (String(error?.code || '').includes('SQLITE_CONSTRAINT_UNIQUE')) {
        throw conflict('Já existe uma conta com este e-mail.', 'EMAIL_JA_CADASTRADO');
      }
      throw error;
    }

    audit({
      action: 'users.update',
      result: 'sucesso',
      actorUserId: actor.id,
      targetUserId: id,
      request,
      metadata: {
        campos: Object.keys(input).filter((field) => field !== 'password'),
        roleAnterior: current.role,
        roleNovo: updated.role,
        planAnterior: current.plan,
        planNovo: updated.plan
      }
    });
    return publicUser(updated);
  }

  function deleteUser(id, actor, request = {}) {
    const current = db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!current) throw notFound('Usuário não encontrado.', 'USUARIO_NAO_ENCONTRADO');
    if (Number(actor.id) === Number(id)) {
      throw conflict('Use o fluxo de exclusão da própria conta.', 'EXCLUSAO_PROPRIA_RESTRITA');
    }

    db.transaction(() => {
      if (current.role === ROLE_ADMIN) {
        const administrators = Number(
          db.get(
            "SELECT COUNT(*) AS total FROM users WHERE role = 'administrador' AND is_active = 1"
          ).total
        );
        if (administrators <= 1) {
          throw conflict(
            'Não é possível excluir o único administrador ativo.',
            'ULTIMO_ADMINISTRADOR'
          );
        }
      }
      db.run('DELETE FROM users WHERE id = ?', [id]);
    });
    audit({
      action: 'users.delete',
      result: 'sucesso',
      actorUserId: actor.id,
      targetUserId: null,
      request
    });
  }

  return {
    audit,
    authenticate,
    bootstrapRequired,
    changeOwnPassword,
    createUser,
    csrfForSession,
    deleteUser,
    ensureSeedAdmin,
    hasRecentAuthentication,
    listUsers,
    login,
    logout,
    publicUser,
    reauthenticate,
    register,
    updateUser,
    verifyCsrf
  };
}

export const AUTH_ROLES = Object.freeze({ ADMIN: ROLE_ADMIN, USER: ROLE_USER });
