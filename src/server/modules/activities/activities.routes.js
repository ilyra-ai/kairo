// ============================================================================
// Kairo — Rotas autenticadas de atividades, períodos e metas
// ============================================================================

import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import {
  activityIdParamsSchema,
  createActivitySchema,
  updateGoalSchema,
  updateTimeframeSchema
} from './activities.schemas.js';

export function createActivitiesRouter(options) {
  const { activitiesService, authService, requireAuth, requireCsrf, mutationLimiter } = options;
  const router = Router();

  router.use(requireAuth);

  router.get('/', (req, res) => {
    res.json(activitiesService.list(req.user.id));
  });

  router.get('/:id/details', validate({ params: activityIdParamsSchema }), (req, res) => {
    res.json(activitiesService.getDetails(req.user.id, req.validated.params.id));
  });

  router.post(
    '/',
    mutationLimiter,
    requireCsrf,
    validate({ body: createActivitySchema }),
    (req, res) => {
      const activity = activitiesService.create(req.user.id, req.validated.body);
      authService.audit({
        action: 'activities.create',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { activityId: activity.id }
      });
      res.status(201).json(activity);
    }
  );

  router.put(
    '/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: activityIdParamsSchema, body: updateTimeframeSchema }),
    (req, res) => {
      const timeframe = activitiesService.updateTimeframe(
        req.user.id,
        req.validated.params.id,
        req.validated.body
      );
      authService.audit({
        action: 'activities.timeframe.update',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { activityId: timeframe.activity_id, timeframe: timeframe.type }
      });
      res.json({ message: 'Horas atualizadas com sucesso.', timeframe });
    }
  );

  router.put(
    '/:id/goals',
    mutationLimiter,
    requireCsrf,
    validate({ params: activityIdParamsSchema, body: updateGoalSchema }),
    (req, res) => {
      const goal = activitiesService.updateGoal(
        req.user.id,
        req.validated.params.id,
        req.validated.body
      );
      authService.audit({
        action: 'activities.goal.update',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { activityId: goal.activity_id, timeframe: goal.type }
      });
      res.json({ message: 'Meta definida com sucesso.', goal });
    }
  );

  router.delete(
    '/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: activityIdParamsSchema }),
    (req, res) => {
      const activity = activitiesService.remove(req.user.id, req.validated.params.id);
      authService.audit({
        action: 'activities.delete',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { activityId: activity.id, deletedEvents: activity.deleted_events }
      });
      res.json({
        message: `Atividade "${activity.title}" excluída com sucesso.`,
        deleted_events: activity.deleted_events
      });
    }
  );

  return router;
}
