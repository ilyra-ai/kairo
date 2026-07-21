// ============================================================================
// Kairo — Contratos das rotas de analytics temporal (Tarefa 20)
// ============================================================================

import { z } from 'zod';

// Lista de inteiros em query string aceita tanto `?years=2026&years=2025`
// (array) quanto `?years=2026` (valor único); ambos viram number[].
function listaDeInteiros(minimo, maximo, mensagem) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((valor) => {
      if (valor === undefined) return [];
      return Array.isArray(valor) ? valor : [valor];
    })
    .pipe(z.array(z.coerce.number().int().min(minimo, mensagem).max(maximo, mensagem)));
}

export const timeseriesQuerySchema = z
  .object({
    years: listaDeInteiros(1970, 2999, 'Ano inválido.'),
    months: listaDeInteiros(1, 12, 'Mês inválido.'),
    days: listaDeInteiros(1, 31, 'Dia inválido.')
  })
  .strip();

export const drilldownQuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A data deve estar no formato AAAA-MM-DD.')
  })
  .strip();
