// ============================================================================
// Kairo — Serviço de perfil individual
// ============================================================================

import { conflict, notFound } from '../../shared/http-error.js';

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
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };
}

export function createProfileService(db) {
  function get(userId) {
    const profile = db.get('SELECT * FROM profile_data WHERE user_id = ?', [userId]);
    if (!profile) throw notFound('Perfil não encontrado.', 'PERFIL_NAO_ENCONTRADO');
    return serializeProfile(profile);
  }

  function update(userId, input, currentSessionId) {
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
           SET username = ?, email = ?, avatar = ?, theme = ?, focus_sound = ?,
               enable_confetti = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?`,
          [
            input.username,
            input.email,
            input.avatar === undefined ? current.avatar : input.avatar,
            input.theme,
            input.focus_sound,
            input.enable_confetti ? 1 : 0,
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

  return { get, update };
}
