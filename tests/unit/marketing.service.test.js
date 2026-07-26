import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createMarketingRouter } from '../../src/server/modules/marketing/marketing.routes.js';
import { createMarketingService } from '../../src/server/modules/marketing/marketing.service.js';

const plansService = {
  getMatrix() {
    return {
      plans: [
        { key: 'free', name: 'Free', price: 0, description: 'Plano inicial.' },
        { key: 'pro', name: 'Pro', price: 3900, description: 'Plano completo.' }
      ],
      features: [
        { key: 'agenda', label: 'Agenda multilayout' },
        { key: 'ai_assistant', label: 'Assistente de IA e chat' }
      ],
      matrix: {
        free: { agenda: true, ai_assistant: false },
        pro: { agenda: true, ai_assistant: true }
      }
    };
  }
};

test('landing pública deriva preços, funcionalidades e disponibilidade das fontes reais', () => {
  const service = createMarketingService({
    plansService,
    paymentsService: {
      listPlans: () => ({
        provider: {
          available: true,
          mode: 'test',
          source: 'environment',
          message: 'Checkout seguro.'
        },
        plans: [
          {
            key: 'free',
            name: 'Free',
            price_cents: 0,
            price_label: 'Grátis',
            description: 'Plano inicial.',
            payable: false,
            checkout_available: false
          },
          {
            key: 'pro',
            name: 'Pro',
            price_cents: 3900,
            price_label: 'R$ 39,00',
            description: 'Plano completo.',
            payable: true,
            checkout_available: true
          }
        ]
      })
    },
    smartFeaturesService: { list: () => Array.from({ length: 12 }, (_, index) => ({ index })) }
  });

  const result = service.landingConfiguration();
  assert.deepEqual(result.plans[0].features, [{ key: 'agenda', label: 'Agenda multilayout' }]);
  assert.equal(result.plans[1].price_label, 'R$ 39,00');
  assert.equal(result.plans[1].checkout_available, true);
  assert.equal(result.checkout.available, true);
  assert.equal(result.smart_features_count, 12);
  assert.equal('mode' in result.checkout, false);
  assert.equal('source' in result.checkout, false);
});

test('landing pública permanece honesta quando o gateway de pagamento não existe', () => {
  const service = createMarketingService({ plansService });
  const result = service.landingConfiguration();

  assert.equal(result.checkout.available, false);
  assert.equal(result.plans[1].checkout_available, false);
  assert.equal(result.plans[1].price_label, 'R$ 39,00');
  assert.equal(result.smart_features_count, 0);
});

test('rota pública entrega somente o catálogo sanitizado sem exigir autenticação', async () => {
  const marketingService = createMarketingService({ plansService });
  const app = express();
  app.use('/api/public', createMarketingRouter({ marketingService }));

  const response = await request(app).get('/api/public/landing').expect(200);
  assert.equal(response.body.plans[0].key, 'free');
  assert.equal(response.body.checkout.available, false);
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
  assert.equal(JSON.stringify(response.body).includes('environment'), false);
});
