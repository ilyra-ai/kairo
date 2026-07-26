// ============================================================================
// Kairo — Rotas Stripe autenticadas e webhook oficial com corpo bruto
// ============================================================================

import express, { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate } from '../../middleware/validation.js';

const checkoutSchema = z.object({ plan_key: z.string().trim().min(1).max(40) }).strict();

const reconciliationSchema = z
  .object({
    checkout_session_id: z
      .string()
      .trim()
      .regex(/^cs_(?:test_|live_)?[A-Za-z0-9_]+$/, 'Sessão Stripe inválida.')
      .max(255)
      .optional()
  })
  .strict();

const priceMapSchema = z.record(
  z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_-]{1,39}$/),
  z
    .string()
    .trim()
    .regex(/^price_[A-Za-z0-9]+$/, 'Informe um Price ID Stripe válido.')
);

const providerConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['test', 'live']),
    secret_key: z.string().trim().min(12).max(300).optional(),
    webhook_secret: z.string().trim().min(12).max(300).optional(),
    public_base_url: z.url().max(500).optional(),
    prices: priceMapSchema.optional(),
    remove_secrets: z.boolean().optional()
  })
  .strict();

const providerTestSchema = providerConfigurationSchema
  .omit({ enabled: true, remove_secrets: true })
  .partial()
  .strict();

function audit(authService, request, action, metadata = undefined) {
  authService.audit({
    action,
    result: 'sucesso',
    actorUserId: request.user.id,
    request,
    metadata
  });
}

export function createPaymentsRouter(options) {
  const { paymentsService, authService, requireAuth, requireAdmin, requireCsrf, mutationLimiter } =
    options;
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/plans',
    asyncHandler(async (_req, res) => res.json(paymentsService.listPlans()))
  );

  router.post(
    '/checkout',
    mutationLimiter,
    requireCsrf,
    validate({ body: checkoutSchema }),
    asyncHandler(async (req, res) => {
      const result = await paymentsService.createCheckout(req.user.id, req.validated.body);
      audit(authService, req, 'payments.checkout.create', {
        checkoutId: result.checkout_id,
        provider: result.provider
      });
      res.status(201).json(result);
    })
  );

  router.get(
    '/subscription',
    asyncHandler(async (req, res) => {
      res.json({
        subscription: paymentsService.getSubscription(req.user.id),
        invoices: paymentsService.listInvoices(req.user.id)
      });
    })
  );

  router.post(
    '/portal',
    mutationLimiter,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const result = await paymentsService.createPortal(req.user.id);
      audit(authService, req, 'payments.portal.create');
      res.json(result);
    })
  );

  router.post(
    '/cancel',
    mutationLimiter,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const result = await paymentsService.cancel(req.user.id);
      audit(authService, req, 'payments.subscription.cancel_schedule', {
        planKey: result.plan_key,
        currentPeriodEnd: result.current_period_end
      });
      res.json(result);
    })
  );

  router.post(
    '/reconcile',
    mutationLimiter,
    requireCsrf,
    validate({ body: reconciliationSchema }),
    asyncHandler(async (req, res) => {
      const result = await paymentsService.reconcileUser(req.user.id, req.validated.body);
      audit(authService, req, 'payments.subscription.reconcile');
      res.json(result);
    })
  );

  router.get(
    '/admin/provider',
    requireAdmin,
    asyncHandler(async (_req, res) => res.json(paymentsService.adminConfiguration()))
  );

  router.post(
    '/admin/provider/test',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    validate({ body: providerTestSchema }),
    asyncHandler(async (req, res) => {
      const result = await paymentsService.testConfiguration(req.validated.body);
      audit(authService, req, 'payments.provider.test', { mode: result.mode });
      res.json(result);
    })
  );

  router.put(
    '/admin/provider',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    validate({ body: providerConfigurationSchema }),
    asyncHandler(async (req, res) => {
      const result = await paymentsService.configureProvider(req.user.id, req.validated.body);
      audit(authService, req, 'payments.provider.configure', {
        enabled: result.enabled,
        mode: result.mode
      });
      res.json(result);
    })
  );

  router.get(
    '/admin/metrics',
    requireAdmin,
    asyncHandler(async (_req, res) => res.json(paymentsService.metrics()))
  );

  router.post(
    '/admin/reconcile',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    asyncHandler(async (req, res) => {
      const result = await paymentsService.reconcileAll();
      audit(authService, req, 'payments.reconcile.all', { users: result.users });
      res.json(result);
    })
  );

  return router;
}

export function createPaymentsWebhookRouter({ paymentsService }) {
  const router = Router();
  router.post(
    '/stripe',
    express.raw({ type: 'application/json', limit: '256kb' }),
    asyncHandler(async (req, res) => {
      const signature = req.get('stripe-signature');
      const result = await paymentsService.handleStripeWebhook(req.body, signature);
      res.status(200).json(result);
    })
  );
  return router;
}
