// ============================================================================
// Kairo — Rotas do termômetro de energia e cronotipo (Tarefa 23)
// ============================================================================

import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import { energyIdParamsSchema, energySettingsSchema, logEnergySchema } from './energy.schemas.js';

export function createEnergyRouter(options) {
  const { energyService, authService, requireAuth, requireCsrf, mutationLimiter } = options;
  const router = Router();

  router.use(requireAuth);

  // Estado consolidado: configuração, escala, heatmap e insights de cronotipo.
  router.get('/', (req, res) => {
    res.json(energyService.state(req.user.id));
  });

  router.get('/recent', (req, res) => {
    res.json(energyService.recent(req.user.id, req.query.limit));
  });

  // Registro com um toque.
  router.post(
    '/',
    mutationLimiter,
    requireCsrf,
    validate({ body: logEnergySchema }),
    (req, res) => {
      const registro = energyService.log(req.user.id, req.validated.body);
      authService.audit({
        action: 'energy.log',
        result: 'sucesso',
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        request: req,
        metadata: { level: registro.level }
      });
      res.status(201).json(registro);
    }
  );

  // Ativar/desativar o recurso.
  router.put(
    '/settings',
    mutationLimiter,
    requireCsrf,
    validate({ body: energySettingsSchema }),
    (req, res) => {
      res.json(energyService.setEnabled(req.user.id, req.validated.body.enabled));
    }
  );

  // Excluir um registro específico.
  router.delete(
    '/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: energyIdParamsSchema }),
    (req, res) => {
      energyService.remove(req.user.id, req.validated.params.id);
      res.status(204).end();
    }
  );

  // Excluir todos os registros e derivados (direito de exclusão).
  router.delete('/', mutationLimiter, requireCsrf, (req, res) => {
    const resultado = energyService.purge(req.user.id);
    authService.audit({
      action: 'energy.purge',
      result: 'sucesso',
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      request: req,
      metadata: { deleted: resultado.deleted }
    });
    res.json(resultado);
  });

  return router;
}
