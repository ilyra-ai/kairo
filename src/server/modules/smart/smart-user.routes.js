// ============================================================================
// Kairo — Rotas de usuário dos recursos inteligentes (Tarefa 35)
// ----------------------------------------------------------------------------
// Endpoints consumidos pelo próprio usuário. Cada engine valida internamente se
// o recurso está habilitado pelo administrador (governança smart_features).
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validation.js';

const autoPlanTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    duration_min: z.coerce.number().int().min(5).max(600),
    activity_id: z.coerce.number().int().positive(),
    priority: z.enum(['baixa', 'media', 'alta']).optional(),
    cognitive_load: z.coerce.number().int().min(1).max(3).optional(),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
  })
  .strict();

const autoPlanSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    tasks: z.array(autoPlanTaskSchema).min(1).max(30)
  })
  .strict();

const autoPlanApplySchema = z
  .object({
    plan: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            activity_id: z.coerce.number().int().positive(),
            event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            start_time: z.string().regex(/^\d{2}:\d{2}$/),
            end_time: z.string().regex(/^\d{2}:\d{2}$/),
            cognitive_load: z.coerce.number().int().min(1).max(3).optional(),
            priority: z.enum(['baixa', 'media', 'alta']).optional()
          })
          .strict()
      )
      .min(1)
      .max(30)
  })
  .strict();

const brainDumpParseSchema = z.object({ text: z.string().trim().min(2).max(8000) }).strict();
const brainDumpCommitSchema = z
  .object({
    items: z
      .array(z.object({ title: z.string().trim().min(1).max(200) }).strict())
      .min(1)
      .max(30)
  })
  .strict();

const passiveRecordSchema = z
  .object({
    section: z.string().trim().min(1).max(80),
    layout: z.string().trim().max(80).optional(),
    focus_seconds: z.coerce.number().int().min(0).max(86400).optional(),
    focused: z.boolean().optional()
  })
  .strict();
const passiveSummarySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
  })
  .strict();
const passivePromoteSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();

export function createSmartUserRouter(options) {
  const {
    energyBudgetService,
    autoSchedulerService,
    brainDumpService,
    passiveTrackingService,
    requireAuth,
    requireCsrf,
    mutationLimiter
  } = options;
  const router = Router();

  router.use(requireAuth);

  // 35.1 — Orçamento de energia do dia (bateria do dia).
  if (energyBudgetService) {
    router.get(
      '/energy-budget',
      asyncHandler(async (req, res) => {
        res.json(energyBudgetService.computeDay(req.user.id, req.query.date));
      })
    );
  }

  // 35.2 — Agendador autônomo: prévia (não aplica) e aplicação real.
  if (autoSchedulerService) {
    router.post(
      '/auto-plan',
      mutationLimiter,
      requireCsrf,
      validate({ body: autoPlanSchema }),
      asyncHandler(async (req, res) => {
        res.json(autoSchedulerService.preview(req.user.id, req.validated.body));
      })
    );

    router.post(
      '/auto-plan/apply',
      mutationLimiter,
      requireCsrf,
      validate({ body: autoPlanApplySchema }),
      asyncHandler(async (req, res) => {
        res.json(autoSchedulerService.apply(req.user.id, req.validated.body));
      })
    );
  }

  // 35.5 — Brain Dump: parse (não persiste) e commit (cria os confirmados).
  if (brainDumpService) {
    router.post(
      '/brain-dump/parse',
      mutationLimiter,
      requireCsrf,
      validate({ body: brainDumpParseSchema }),
      asyncHandler(async (req, res) => {
        res.json(brainDumpService.parse(req.user.id, req.validated.body));
      })
    );

    router.post(
      '/brain-dump/commit',
      mutationLimiter,
      requireCsrf,
      validate({ body: brainDumpCommitSchema }),
      asyncHandler(async (req, res) => {
        res.json(brainDumpService.commit(req.user.id, req.validated.body));
      })
    );
  }

  // 35.3 — Rastreamento Passivo: registro consentido, resumo e promoção manual.
  if (passiveTrackingService) {
    router.post(
      '/passive/record',
      mutationLimiter,
      requireCsrf,
      validate({ body: passiveRecordSchema }),
      asyncHandler(async (req, res) => {
        res.json(passiveTrackingService.record(req.user.id, req.validated.body));
      })
    );

    router.get(
      '/passive/summary',
      validate({ query: passiveSummarySchema }),
      asyncHandler(async (req, res) => {
        res.json(passiveTrackingService.summary(req.user.id, req.validated.query));
      })
    );

    router.post(
      '/passive/promote',
      mutationLimiter,
      requireCsrf,
      validate({ body: passivePromoteSchema }),
      asyncHandler(async (req, res) => {
        res.json(passiveTrackingService.promote(req.user.id, req.validated.body));
      })
    );
  }

  return router;
}
