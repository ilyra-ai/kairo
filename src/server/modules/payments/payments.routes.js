// ============================================================================
// Kairo — Rotas de pagamentos e planos (Tarefa 13)
// ----------------------------------------------------------------------------
// Endpoints do usuário para ver planos, iniciar checkout, consultar e cancelar
// a assinatura; e o endpoint de WEBHOOK do provedor (sem sessão, autenticado por
// assinatura HMAC). O webhook aplica o plano de verdade ao usuário.
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validation.js';

const checkoutSchema = z
  .object({
    plan_key: z.string().trim().min(1).max(40),
    provider: z.enum(['stripe', 'mercadopago', 'manual']).optional()
  })
  .strict();

const webhookProviderSchema = z
  .object({ provider: z.enum(['stripe', 'mercadopago', 'manual']) })
  .strict();

const webhookBodySchema = z
  .object({
    event_id: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(80),
    external_ref: z.string().trim().min(1).max(200),
    status: z.string().trim().max(40).optional()
  })
  .strict();

// Rotas autenticadas (usuário logado).
export function createPaymentsRouter(options) {
  const { paymentsService, requireAuth, requireCsrf, mutationLimiter } = options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/plans',
    asyncHandler(async (_req, res) => {
      res.json({ plans: paymentsService.listPlans() });
    })
  );

  router.post(
    '/checkout',
    mutationLimiter,
    requireCsrf,
    validate({ body: checkoutSchema }),
    asyncHandler(async (req, res) => {
      res.status(201).json(paymentsService.createCheckout(req.user.id, req.validated.body));
    })
  );

  router.get(
    '/subscription',
    asyncHandler(async (req, res) => {
      res.json({ subscription: paymentsService.getActiveSubscription(req.user.id) });
    })
  );

  router.post(
    '/cancel',
    mutationLimiter,
    requireCsrf,
    asyncHandler(async (req, res) => {
      res.json(paymentsService.cancel(req.user.id));
    })
  );

  return router;
}

// Router público do webhook (sem sessão; autenticado pela assinatura HMAC).
export function createPaymentsWebhookRouter(options) {
  const { paymentsService } = options;
  const router = Router();

  router.post(
    '/:provider',
    validate({ params: webhookProviderSchema, body: webhookBodySchema }),
    asyncHandler(async (req, res) => {
      const signature = req.get('x-kairo-signature') || req.get('x-signature') || null;
      const resultado = paymentsService.handleWebhook(
        req.validated.params.provider,
        req.validated.body,
        signature
      );
      res.json(resultado);
    })
  );

  return router;
}
