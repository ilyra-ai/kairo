// ============================================================================
// Kairo — Rotas administrativas de planos e funcionalidades
// ============================================================================

import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import {
  createFeatureSchema,
  createPlanSchema,
  featureKeyParamsSchema,
  planKeyParamsSchema,
  toggleFeatureSchema,
  updatePlanSchema
} from './plans.schemas.js';

export function createPlansRouter(options) {
  const {
    plansService,
    authService,
    requireAuth,
    requireAdmin,
    requireCsrf,
    mutationLimiter
  } = options;
  const router = Router();

  router.use(requireAuth);

  router.get('/plans', (_req, res) => {
    res.json(plansService.getMatrix());
  });

  router.post(
    '/plans/toggle',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    validate({ body: toggleFeatureSchema }),
    (req, res) => {
      const result = plansService.toggleFeature(req.validated.body);
      authService.audit({
        action: 'plans.feature.toggle',
        result: 'sucesso',
        actorUserId: req.user.id,
        request: req
      });
      res.json(result);
    }
  );

  router.post(
    '/plans',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    validate({ body: createPlanSchema }),
    (req, res) => {
      const plan = plansService.createPlan(req.validated.body);
      authService.audit({
        action: 'plans.create',
        result: 'sucesso',
        actorUserId: req.user.id,
        request: req
      });
      res.status(201).json(plan);
    }
  );

  router.put(
    '/plans/:key',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    validate({ params: planKeyParamsSchema, body: updatePlanSchema }),
    (req, res) => {
      const plan = plansService.updatePlan(req.validated.params.key, req.validated.body);
      authService.audit({
        action: 'plans.update',
        result: 'sucesso',
        actorUserId: req.user.id,
        request: req
      });
      res.json(plan);
    }
  );

  router.delete(
    '/plans/:key',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    validate({ params: planKeyParamsSchema }),
    (req, res) => {
      plansService.deletePlan(req.validated.params.key);
      authService.audit({
        action: 'plans.delete',
        result: 'sucesso',
        actorUserId: req.user.id,
        request: req
      });
      res.status(204).end();
    }
  );

  router.post(
    '/features',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    validate({ body: createFeatureSchema }),
    (req, res) => {
      const feature = plansService.createFeature(req.validated.body);
      authService.audit({
        action: 'features.create',
        result: 'sucesso',
        actorUserId: req.user.id,
        request: req
      });
      res.status(201).json(feature);
    }
  );

  router.delete(
    '/features/:key',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    validate({ params: featureKeyParamsSchema }),
    (req, res) => {
      plansService.deleteFeature(req.validated.params.key);
      authService.audit({
        action: 'features.delete',
        result: 'sucesso',
        actorUserId: req.user.id,
        request: req
      });
      res.status(204).end();
    }
  );

  return router;
}
