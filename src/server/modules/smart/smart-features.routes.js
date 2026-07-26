// ============================================================================
// Kairo — Rotas administrativas da suíte inteligente (Tarefa 35.0)
// ----------------------------------------------------------------------------
// Governança dos recursos inteligentes: só o administrador lista, edita, testa
// e audita. Dupla proteção: menu oculto no frontend + requireAdmin no backend.
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validation.js';

const featureKeyParamsSchema = z.object({ key: z.string().trim().min(2).max(60) }).strict();

const updateFeatureSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().min(10).max(600).optional(),
    category: z.string().trim().min(2).max(40).optional(),
    requires_ai: z.boolean().optional(),
    enabled: z.boolean().optional(),
    params: z.record(z.string(), z.any()).optional(),
    ai_connection_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    ai_artifact_id: z.union([z.coerce.number().int().positive(), z.null()]).optional()
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Informe ao menos um campo.');

const createFeatureSchema = z
  .object({
    key: z.string().trim().min(2).max(60),
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().min(10).max(600).optional(),
    category: z.string().trim().min(2).max(40).optional(),
    requires_ai: z.boolean().optional(),
    enabled: z.boolean().optional(),
    default_params: z.record(z.string(), z.any()).optional()
  })
  .strict();

export function createSmartFeaturesRouter(options) {
  const {
    smartFeaturesService,
    emotionalMapService,
    authService,
    requireAuth,
    requireAdmin,
    requireCsrf,
    mutationLimiter
  } = options;
  const router = Router();

  router.use(requireAuth, requireAdmin);

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({
        features: smartFeaturesService.list(),
        templates: smartFeaturesService.listTemplates()
      });
    })
  );

  router.post(
    '/',
    mutationLimiter,
    requireCsrf,
    validate({ body: createFeatureSchema }),
    asyncHandler(async (req, res) => {
      const feature = smartFeaturesService.create(req.validated.body, req.user.id);
      authService.audit({
        action: 'smart_feature.create',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { key: feature.key }
      });
      res.status(201).json(feature);
    })
  );

  if (emotionalMapService) {
    router.get(
      '/privacy/emotional-summary',
      asyncHandler(async (_req, res) => {
        res.json(emotionalMapService.anonymousSummary());
      })
    );
  }

  router.get(
    '/:key',
    validate({ params: featureKeyParamsSchema }),
    asyncHandler(async (req, res) => {
      res.json(smartFeaturesService.get(req.validated.params.key));
    })
  );

  router.put(
    '/:key',
    mutationLimiter,
    requireCsrf,
    validate({ params: featureKeyParamsSchema, body: updateFeatureSchema }),
    asyncHandler(async (req, res) => {
      const feature = smartFeaturesService.updateConfig(
        req.validated.params.key,
        req.validated.body,
        req.user.id
      );
      authService.audit({
        action: 'smart_feature.update',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { key: feature.key, enabled: feature.enabled }
      });
      res.json(feature);
    })
  );

  router.post(
    '/:key/test',
    mutationLimiter,
    requireCsrf,
    validate({ params: featureKeyParamsSchema }),
    asyncHandler(async (req, res) => {
      res.json(await smartFeaturesService.test(req.validated.params.key));
    })
  );

  router.get(
    '/:key/audit',
    validate({ params: featureKeyParamsSchema }),
    asyncHandler(async (req, res) => {
      res.json({
        events: smartFeaturesService.listAudit(req.validated.params.key, req.query.limit)
      });
    })
  );

  router.delete(
    '/:key',
    mutationLimiter,
    requireCsrf,
    validate({ params: featureKeyParamsSchema }),
    asyncHandler(async (req, res) => {
      const result = smartFeaturesService.remove(req.validated.params.key, req.user.id);
      authService.audit({
        action: 'smart_feature.delete',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { key: result.key }
      });
      res.json(result);
    })
  );

  return router;
}
