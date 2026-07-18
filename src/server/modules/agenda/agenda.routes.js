// ============================================================================
// Kairo — Rotas autenticadas e protegidas da agenda
// ============================================================================

import { Router } from 'express';
import { validate } from '../../middleware/validation.js';
import {
  agendaActivityParamsSchema,
  agendaIdParamsSchema,
  createAgendaEventSchema,
  listAgendaQuerySchema,
  updateAgendaCompletionSchema,
  updateAgendaEventSchema
} from './agenda.schemas.js';

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`${name} precisa ser uma função.`);
  }
  return value;
}

export function createAgendaRouter(options = {}) {
  const agendaService = options.agendaService;
  if (!agendaService) throw new Error('O serviço de agenda é obrigatório.');

  const requireAuth = requireFunction(options.requireAuth, 'requireAuth');
  const requireCsrf = requireFunction(options.requireCsrf, 'requireCsrf');
  const mutationLimiter = requireFunction(options.mutationLimiter, 'mutationLimiter');
  const router = Router();

  router.use(requireAuth);

  router.get('/agenda', validate({ query: listAgendaQuerySchema }), (req, res) => {
    res.json(agendaService.list(req.user.id, req.validated.query));
  });

  router.get('/agenda/:id', validate({ params: agendaIdParamsSchema }), (req, res) => {
    res.json(agendaService.get(req.user.id, req.validated.params.id));
  });

  router.get(
    '/activities/:activity_id/agenda',
    validate({ params: agendaActivityParamsSchema }),
    (req, res) => {
      res.json(agendaService.listByActivity(req.user.id, req.validated.params.activity_id));
    }
  );

  router.post(
    '/agenda',
    mutationLimiter,
    requireCsrf,
    validate({ body: createAgendaEventSchema }),
    (req, res) => {
      const event = agendaService.create(req.user.id, req.validated.body);
      res.status(201).json({
        message: 'Compromisso agendado com sucesso.',
        event
      });
    }
  );

  router.put(
    '/agenda/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: agendaIdParamsSchema, body: updateAgendaEventSchema }),
    (req, res) => {
      const event = agendaService.update(req.user.id, req.validated.params.id, req.validated.body);
      res.json({
        message: 'Compromisso atualizado com sucesso.',
        event
      });
    }
  );

  router.patch(
    '/agenda/:id/completion',
    mutationLimiter,
    requireCsrf,
    validate({ params: agendaIdParamsSchema, body: updateAgendaCompletionSchema }),
    (req, res) => {
      const event = agendaService.updateCompletion(
        req.user.id,
        req.validated.params.id,
        req.validated.body
      );
      res.json({
        message: event.is_completed
          ? 'Compromisso concluído com sucesso.'
          : 'Compromisso reaberto com sucesso.',
        event
      });
    }
  );

  router.delete(
    '/agenda/:id',
    mutationLimiter,
    requireCsrf,
    validate({ params: agendaIdParamsSchema }),
    (req, res) => {
      agendaService.remove(req.user.id, req.validated.params.id);
      res.status(204).end();
    }
  );

  return router;
}
