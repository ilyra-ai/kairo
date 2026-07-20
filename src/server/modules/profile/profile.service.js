// ============================================================================
// Kairo — Serviço de perfil individual
// ============================================================================

import { conflict, notFound } from '../../shared/http-error.js';

// Intervalos aceitos pelo dashboard em tempo real (Tarefa 18): o polling é
// configurável pelo usuário entre 15 e 30 segundos.
export const INTERVALOS_AO_VIVO = Object.freeze([15, 20, 30]);
const INTERVALO_AO_VIVO_PADRAO = 20;

function serializeProfile(profile) {
  if (!profile) return null;
  return {
    id: Number(profile.id),
    username: profile.username,
    email: profile.email,
    avatar: profile.avatar,
    theme: profile.theme,
    focus_sound: profile.focus_sound,
    enable_confetti: Boolean(profile.enable_confetti),
    live_refresh_seconds: Number(profile.live_refresh_seconds ?? INTERVALO_AO_VIVO_PADRAO),
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };
}

export function createProfileService(db) {
  // Evolução de esquema idempotente e preguiçosa: bancos criados antes da
  // Tarefa 18 ganham a coluna do intervalo ao vivo sem migração destrutiva.
  // A garantia é adiada porque `profile_data` só nasce com o primeiro usuário.
  let colunaAoVivoGarantida = false;
  function garantirColunaAoVivo() {
    if (colunaAoVivoGarantida) return;
    const tabelaExiste = db.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile_data'"
    );
    if (!tabelaExiste) return;
    const columns = db.all('PRAGMA table_info(profile_data)').map((column) => column.name);
    if (!columns.includes('live_refresh_seconds')) {
      db.exec(
        `ALTER TABLE profile_data
           ADD COLUMN live_refresh_seconds INTEGER NOT NULL DEFAULT ${INTERVALO_AO_VIVO_PADRAO}`
      );
    }
    colunaAoVivoGarantida = true;
  }

  function get(userId) {
    garantirColunaAoVivo();
    const profile = db.get('SELECT * FROM profile_data WHERE user_id = ?', [userId]);
    if (!profile) throw notFound('Perfil não encontrado.', 'PERFIL_NAO_ENCONTRADO');
    return serializeProfile(profile);
  }

  function update(userId, input, currentSessionId) {
    garantirColunaAoVivo();
    const current = db.get('SELECT * FROM profile_data WHERE user_id = ?', [userId]);
    if (!current) throw notFound('Perfil não encontrado.', 'PERFIL_NAO_ENCONTRADO');

    try {
      const updated = db.transaction(() => {
        const emailChanged = current.email.toLowerCase() !== input.email.toLowerCase();
        db.run(
          `UPDATE users
           SET name = ?, email = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [input.username, input.email, userId]
        );
        db.run(
          `UPDATE profile_data
           SET username = ?, email = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?`,
          [
            input.username,
            input.email,
            input.avatar === undefined ? current.avatar : input.avatar,
            userId
          ]
        );

        if (emailChanged) {
          db.run(
            `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
            [userId, currentSessionId]
          );
        }
        return db.get('SELECT * FROM profile_data WHERE user_id = ?', [userId]);
      });
      return serializeProfile(updated);
    } catch (error) {
      if (String(error?.code || '').includes('SQLITE_CONSTRAINT_UNIQUE')) {
        throw conflict('Já existe uma conta com este e-mail.', 'EMAIL_JA_CADASTRADO');
      }
      throw error;
    }
  }

  function updatePreferences(userId, input) {
    garantirColunaAoVivo();
    const current = db.get('SELECT id, live_refresh_seconds FROM profile_data WHERE user_id = ?', [
      userId
    ]);
    if (!current) throw notFound('Perfil não encontrado.', 'PERFIL_NAO_ENCONTRADO');

    const liveRefreshSeconds =
      input.live_refresh_seconds === undefined
        ? Number(current.live_refresh_seconds ?? INTERVALO_AO_VIVO_PADRAO)
        : input.live_refresh_seconds;

    const updated = db.transaction(() => {
      db.run(
        `UPDATE profile_data
         SET theme = ?, focus_sound = ?, enable_confetti = ?, live_refresh_seconds = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [input.theme, input.focus_sound, input.enable_confetti ? 1 : 0, liveRefreshSeconds, userId]
      );
      return db.get('SELECT * FROM profile_data WHERE user_id = ?', [userId]);
    });
    return serializeProfile(updated);
  }

  return { get, update, updatePreferences };
}
