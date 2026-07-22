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

const transitionPlanSchema = z
  .object({
    from: z.string().trim().max(200).optional(),
    to: z.string().trim().max(200).optional()
  })
  .strict();
const transitionCompleteSchema = z
  .object({
    from: z.string().trim().max(200).optional(),
    to: z.string().trim().max(200).optional(),
    duration_seconds: z.coerce.number().int().min(0).max(3600).optional(),
    completed: z.boolean().optional()
  })
  .strict();

const reminderScheduleSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    base_at: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/),
    ref_type: z.string().trim().max(40).optional(),
    ref_id: z.coerce.number().int().positive().optional()
  })
  .strict();
const reminderIdSchema = z.object({ id: z.coerce.number().int().positive() }).strict();
const reminderActSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    action: z.enum(['done', 'snooze']),
    snooze_minutes: z.coerce.number().int().min(1).max(1440).optional()
  })
  .strict();

const timeMachineSchema = z
  .object({
    extra_hours_per_day: z.coerce.number().min(0).max(24).optional(),
    rhythm_window_days: z.coerce.number().int().min(1).max(90).optional()
  })
  .strict();

export function createSmartUserRouter(options) {
  const {
    energyBudgetService,
    autoSchedulerService,
    brainDumpService,
    passiveTrackingService,
    transitionBridgeService,
    escalatedRemindersService,
    nowModeService,
    predictiveCoachService,
    focusTimeMachineService,
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

  // 35.4 — Ponte de Transição: roteiro do ritual, registro de conclusão e stats.
  if (transitionBridgeService) {
    router.post(
      '/transition/plan',
      mutationLimiter,
      requireCsrf,
      validate({ body: transitionPlanSchema }),
      asyncHandler(async (req, res) => {
        res.json(transitionBridgeService.plan(req.user.id, req.validated.body));
      })
    );

    router.post(
      '/transition/complete',
      mutationLimiter,
      requireCsrf,
      validate({ body: transitionCompleteSchema }),
      asyncHandler(async (req, res) => {
        res.json(transitionBridgeService.complete(req.user.id, req.validated.body));
      })
    );

    router.get(
      '/transition/stats',
      asyncHandler(async (req, res) => {
        res.json(transitionBridgeService.stats(req.user.id));
      })
    );
  }

  // 35.6 — Lembretes Persistentes Escalonados: agendar, vencidos, escalonar, agir.
  if (escalatedRemindersService) {
    router.post(
      '/reminders/schedule',
      mutationLimiter,
      requireCsrf,
      validate({ body: reminderScheduleSchema }),
      asyncHandler(async (req, res) => {
        res.status(201).json(escalatedRemindersService.schedule(req.user.id, req.validated.body));
      })
    );

    router.get(
      '/reminders/due',
      asyncHandler(async (req, res) => {
        res.json({ reminders: escalatedRemindersService.due(req.user.id) });
      })
    );

    router.post(
      '/reminders/escalate',
      mutationLimiter,
      requireCsrf,
      validate({ body: reminderIdSchema }),
      asyncHandler(async (req, res) => {
        res.json(escalatedRemindersService.escalate(req.user.id, req.validated.body));
      })
    );

    router.post(
      '/reminders/act',
      mutationLimiter,
      requireCsrf,
      validate({ body: reminderActSchema }),
      asyncHandler(async (req, res) => {
        res.json(escalatedRemindersService.act(req.user.id, req.validated.body));
      })
    );
  }

  // 35.7 — Modo Agora: estado do momento (evento atual e próximo).
  if (nowModeService) {
    router.get(
      '/now',
      asyncHandler(async (req, res) => {
        res.json(nowModeService.current(req.user.id));
      })
    );
  }

  // 35.8 — Coach Preditivo: análise proativa de padrões de risco.
  if (predictiveCoachService) {
    router.get(
      '/coach/analyze',
      asyncHandler(async (req, res) => {
        res.json(predictiveCoachService.analyze(req.user.id));
      })
    );
  }

  // 35.9 — Máquina do Tempo do Foco: projeção de metas e cenário ajustado.
  if (focusTimeMachineService) {
    router.get(
      '/time-machine',
      validate({ query: timeMachineSchema }),
      asyncHandler(async (req, res) => {
        res.json(focusTimeMachineService.project(req.user.id, req.validated.query));
      })
    );
  }

  return router;
}
