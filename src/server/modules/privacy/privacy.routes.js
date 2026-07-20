// ============================================================================
// Kairo — Rotas de privacidade, retenção legal e exclusão da própria conta
// ============================================================================

import { Router } from 'express';
import { asyncHandler, validate } from '../../middleware/validation.js';
import {
  createPrivacyRequestSchema,
  deleteAccountSchema,
  privacyRequestIdParamsSchema,
  resolvePrivacyRequestSchema
} from './privacy.schemas.js';

export function createPrivacyRouter(options) {
  const {
    privacyService,
    requireAuth,
    requireAdmin,
    requireCsrf,
    sensitiveLimiter,
    mutationLimiter,
    cookieName
  } = options;
  const router = Router();

  router.use(requireAuth);

  // Matriz de retenção pública para o titular autenticado: transparência
  // sobre o que é conservado, com qual base legal e por quanto tempo.
  router.get('/policies', (_req, res) => {
    res.json(privacyService.policies());
  });

  // Retenções vigentes relacionadas ao próprio titular.
  router.get('/retention', (req, res) => {
    res.json(privacyService.retentionSummaryFor(req.user));
  });

  // Solicitações formais do titular (LGPD art. 18).
  router.get('/requests', (req, res) => {
    res.json(privacyService.listOwnRequests(req.user));
  });

  router.post(
    '/requests',
    mutationLimiter,
    requireCsrf,
    validate({ body: createPrivacyRequestSchema }),
    (req, res) => {
      const created = privacyService.createRequest(req.user, req.validated.body);
      res.status(201).json(created);
    }
  );

  // Fila administrativa de solicitações — o administrador acompanha e conclui
  // os pedidos, sem qualquer acesso a conteúdo bruto de memória.
  router.get('/admin/requests', requireAdmin, (_req, res) => {
    res.json(privacyService.listAllRequests());
  });

  router.put(
    '/admin/requests/:id',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    validate({ params: privacyRequestIdParamsSchema, body: resolvePrivacyRequestSchema }),
    (req, res) => {
      const updated = privacyService.resolveRequest(
        req.validated.params.id,
        req.validated.body,
        req.user
      );
      res.json(updated);
    }
  );

  // Rotina de vencimento da retenção: elimina ou anonimiza conforme política.
  router.post(
    '/admin/retention/enforce',
    mutationLimiter,
    requireAdmin,
    requireCsrf,
    (req, res) => {
      res.json(privacyService.enforceRetentionExpiry(req.user));
    }
  );

  // Exclusão definitiva da própria conta (zona de perigo do Meu Perfil).
  // Exceção única e deliberada da política de senha: a senha atual é digitada
  // no próprio formulário por se tratar de operação irreversível.
  router.post(
    '/account/delete',
    sensitiveLimiter,
    requireCsrf,
    validate({ body: deleteAccountSchema }),
    asyncHandler(async (req, res) => {
      privacyService.assertNotDeletingOthers(req.user.id, req.user.id);
      const receipt = await privacyService.deleteOwnAccount(
        req.user,
        { password: req.validated.body.password },
        req
      );
      res.clearCookie(cookieName, { httpOnly: true, path: '/' });
      res.json({
        message: 'Conta excluída definitivamente. Comprovante gerado.',
        receipt
      });
    })
  );

  return router;
}
