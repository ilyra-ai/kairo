// ============================================================================
// Kairo — Conteúdo público da landing derivado das fontes funcionais reais
// ============================================================================

export function createMarketingService({ plansService, paymentsService, smartFeaturesService }) {
  if (!plansService) {
    throw new Error('O serviço de planos é obrigatório para compor a landing pública.');
  }

  function landingConfiguration() {
    const matrix = plansService.getMatrix();
    const billing = paymentsService?.listPlans?.() ?? {
      provider: {
        available: false,
        message: 'Pagamentos temporariamente indisponíveis; procure o administrador.'
      },
      plans: matrix.plans.map((plan) => ({
        key: plan.key,
        name: plan.name,
        price_cents: Number(plan.price),
        price_label:
          Number(plan.price) > 0
            ? `R$ ${(Number(plan.price) / 100).toFixed(2).replace('.', ',')}`
            : 'Grátis',
        description: plan.description,
        payable: Number(plan.price) > 0,
        checkout_available: false
      }))
    };
    const featureLabels = new Map(matrix.features.map((feature) => [feature.key, feature.label]));

    return {
      plans: billing.plans.map((plan) => ({
        key: plan.key,
        name: plan.name,
        price_cents: plan.price_cents,
        price_label: plan.price_label,
        description: plan.description,
        payable: Boolean(plan.payable),
        checkout_available: Boolean(plan.checkout_available),
        features: Object.entries(matrix.matrix[plan.key] ?? {})
          .filter(([, enabled]) => enabled)
          .map(([key]) => ({ key, label: featureLabels.get(key) ?? key }))
      })),
      checkout: {
        available: Boolean(billing.provider?.available),
        message:
          billing.provider?.message ||
          'Pagamentos temporariamente indisponíveis; procure o administrador.'
      },
      smart_features_count: smartFeaturesService?.list?.().length ?? 0
    };
  }

  return Object.freeze({ landingConfiguration });
}
