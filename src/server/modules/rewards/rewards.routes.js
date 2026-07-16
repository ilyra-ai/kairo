// ============================================================================
// Kairo — Rotas autenticadas de recompensas e administração dopaminérgica
// ============================================================================

import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import {
  aiRewardConfigSchema,
  completionSchema,
  createDopamenuItemSchema,
  dopamenuIdParamsSchema,
  generatorConfigSchema,
  rewardFeedbackSchema,
  updateDopamenuItemSchema
} from './rewards.schemas.js';

/**
 * O roteador preserva os endereços públicos legados quando montado em `/api`:
 * `/api/rewards/*` e `/api/dopamenu/*`.
 */
export function createRewardsRouter(options) {
  const {
    rewardsService,
    authService,
    requireAuth,
    requireAdmin,
    requireCsrf,
    requireRecentAuth,
    mutationLimiter
  } = options;
  const router = Router();

  router.use(requireAuth);

  router.get('/rewards/state', (req, res) => {
    res.json(rewardsService.getState(req.user.id));
  });

  router.post(
    '/rewards/complete',
    mutationLimiter,
    requireCsrf,
    validate({ body: completionSchema }),
    (req, res) => {
      const reward = rewardsService.registerCompletion(req.user.id, req.validated.body);
      authService.audit({
        action: 'rewards.complete',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: {
          agendaEventId: reward.agenda_event_id,
          rewardEventId: reward.event_id,
          idempotent: reward.idempotent
        }
      });
      res.json(reward);
    }
  );

  router.post(
    '/rewards/feedback',
    mutationLimiter,
    requireCsrf,
    validate({ body: rewardFeedbackSchema }),
    (req, res) => {
      const feedback = rewardsService.submitFeedback(req.user.id, req.validated.body);
      authService.audit({
        action: 'rewards.feedback.create',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { rewardEventId: feedback.event_id }
      });
      res.json({ ok: true, ...feedback });
    }
  );

  router.get('/dopamenu', (req, res) => {
    res.json(rewardsService.getDopamenu(req.user.id));
  });

  router.post(
    '/dopamenu',
    mutationLimiter,
    requireCsrf,
    validate({ body: createDopamenuItemSchema }),
    (req, res) => {
      const item = rewardsService.addDopamenuItem(req.user.id, req.validated.body);
      authService.audit({
        action: 'dopamenu.create',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { dopamenuItemId: item.id }
      });
      res.status(201).json(item);
    }
  );

  router.put(
    '/dopamenu/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: dopamenuIdParamsSchema, body: updateDopamenuItemSchema }),
    (req, res) => {
      const item = rewardsService.updateDopamenuItem(
        req.user.id,
        req.validated.params.id,
        req.validated.body
      );
      authService.audit({
        action: 'dopamenu.update',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { dopamenuItemId: item.id }
      });
      res.json(item);
    }
  );

  router.delete(
    '/dopamenu/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: dopamenuIdParamsSchema }),
    (req, res) => {
      const item = rewardsService.deleteDopamenuItem(req.user.id, req.validated.params.id);
      authService.audit({
        action: 'dopamenu.delete',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { dopamenuItemId: item.id }
      });
      res.json({ message: 'Item removido com sucesso.', item });
    }
  );

  router.get('/rewards/config', requireAdmin, (_req, res) => {
    res.json(rewardsService.getConfig());
  });

  router.post(
    '/rewards/config',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    requireRecentAuth,
    validate({ body: generatorConfigSchema }),
    (req, res) => {
      const config = rewardsService.setGeneratorEnabled(req.validated.body);
      authService.audit({
        action: 'rewards.config.update',
        result: 'sucesso',
        actorUserId: req.user.id,
        request: req,
        metadata: { generator: config.key, enabled: config.enabled }
      });
      res.json(config);
    }
  );

  router.post(
    '/rewards/ai',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    requireRecentAuth,
    validate({ body: aiRewardConfigSchema }),
    (req, res) => {
      const config = rewardsService.setAiFlag(req.validated.body);
      authService.audit({
        action: 'rewards.ai-config.update',
        result: 'sucesso',
        actorUserId: req.user.id,
        request: req,
        metadata: { key: config.key, value: config.value }
      });
      res.json(config);
    }
  );

  router.get('/rewards/dashboard', requireAdmin, (_req, res) => {
    res.json(rewardsService.getExecutiveDashboard());
  });

  return router;
}
