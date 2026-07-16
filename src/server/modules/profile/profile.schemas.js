// ============================================================================
// Kairo — Contrato seguro de atualização do perfil
// ============================================================================

import { z } from 'zod';

const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

function isValidAvatar(dataUrl) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return false;

  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return false;

  const mime = match[1];
  if (mime === 'png') {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === 'jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

const avatar = z.string()
  .max(4_200_000, 'O avatar excede o limite permitido.')
  .refine(isValidAvatar, 'Envie uma imagem PNG, JPEG ou WebP válida de até 3 MB.')
  .nullable();

export const updateProfileSchema = z.object({
  username: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254),
  avatar: avatar.optional(),
  theme: z.enum(['escuro', 'claro']),
  focus_sound: z.enum(['chuva', 'ondas', 'ruido', 'binaural', 'nenhum']),
  enable_confetti: z.boolean()
}).strict();
