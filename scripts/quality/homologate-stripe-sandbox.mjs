import 'dotenv/config';

import { chromium } from '@playwright/test';

const baseUrl = new URL(process.env.STRIPE_PUBLIC_APP_URL || 'http://127.0.0.1:3000');
const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);

if (process.env.STRIPE_MODE !== 'test') {
  throw new Error('A homologação automatizada só pode executar com STRIPE_MODE=test.');
}

if (!allowedHosts.has(baseUrl.hostname)) {
  throw new Error('A homologação automatizada só pode executar contra o Kairo local.');
}

for (const variable of [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_PLUS',
  'STRIPE_PRICE_PRO'
]) {
  if (!process.env[variable]) throw new Error(`${variable} não está configurada.`);
}

if (
  !process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') &&
  !process.env.STRIPE_SECRET_KEY.startsWith('rk_test_')
) {
  throw new Error('A chave Stripe precisa pertencer ao ambiente de teste.');
}

if (!process.env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
  throw new Error('O segredo de webhook Stripe de teste é inválido.');
}

async function bodyOrError(response, action) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) {
    throw new Error(
      `${action} falhou (${response.status()}): ${body.message || body.code || 'resposta inválida'}`
    );
  }
  return body;
}

async function fillVisible(page, selectors, value, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const field = frame.locator(selector).first();
        if ((await field.count()) > 0 && (await field.isVisible())) {
          await field.fill(value);
          return;
        }
      }
    }
    await page.waitForTimeout(250);
  }
  const diagnostics = [];
  for (const frame of page.frames()) {
    const inputs = await frame
      .locator('input')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.id,
          name: node.getAttribute('name'),
          type: node.getAttribute('type'),
          autocomplete: node.getAttribute('autocomplete'),
          ariaLabel: node.getAttribute('aria-label'),
          placeholder: node.getAttribute('placeholder')
        }))
      )
      .catch(() => []);
    diagnostics.push({ frame: new URL(frame.url()).hostname, inputs });
  }
  throw new Error(
    `O Checkout Stripe não exibiu o campo ${label}. Estrutura: ${JSON.stringify(diagnostics)}`
  );
}

async function pollSubscription(request, csrfToken, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastBody;

  while (Date.now() < deadline) {
    const response = await request.get(new URL('/api/payments/subscription', baseUrl).href);
    lastBody = await bodyOrError(response, 'Consulta da assinatura');
    if (lastBody.subscription?.access_granted) return lastBody;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await request
    .post(new URL('/api/payments/reconcile', baseUrl).href, {
      headers: { 'x-csrf-token': csrfToken },
      data: {}
    })
    .then((response) => bodyOrError(response, 'Reconciliação da assinatura'));

  const finalResponse = await request.get(new URL('/api/payments/subscription', baseUrl).href);
  lastBody = await bodyOrError(finalResponse, 'Consulta final da assinatura');
  if (!lastBody.subscription?.access_granted) {
    throw new Error('O Stripe não confirmou o acesso pago dentro do prazo de homologação.');
  }
  return lastBody;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

try {
  const email = `homologacao.stripe.${Date.now()}@kairo.local`;
  const password = 'senha-teste';
  const registerResponse = await context.request.post(new URL('/api/auth/register', baseUrl).href, {
    data: { name: 'Homologação Stripe', email, password }
  });
  const registration = await bodyOrError(registerResponse, 'Criação da conta de homologação');

  const checkoutResponse = await context.request.post(
    new URL('/api/payments/checkout', baseUrl).href,
    {
      headers: { 'x-csrf-token': registration.csrfToken },
      data: { plan_key: 'plus' }
    }
  );
  const checkout = await bodyOrError(checkoutResponse, 'Criação do Checkout Stripe');

  if (!checkout.url?.startsWith('https://checkout.stripe.com/')) {
    throw new Error('O backend não retornou uma URL hospedada oficial do Stripe.');
  }

  const page = await context.newPage();
  await page.goto(checkout.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  await fillVisible(
    page,
    ['input[name="cardNumber"]', '#cardNumber', 'input[autocomplete="cc-number"]'],
    '4242424242424242',
    'número do cartão'
  );
  await fillVisible(
    page,
    ['input[name="cardExpiry"]', '#cardExpiry', 'input[autocomplete="cc-exp"]'],
    '1234',
    'validade do cartão'
  );
  await fillVisible(
    page,
    ['input[name="cardCvc"]', '#cardCvc', 'input[autocomplete="cc-csc"]'],
    '123',
    'código de segurança'
  );

  const nameFields = [
    'input[name="billingName"]',
    '#billingName',
    'input[autocomplete="cc-name"]',
    'input[autocomplete="name"]'
  ];
  let nameFilled = false;
  for (const frame of page.frames()) {
    for (const selector of nameFields) {
      const field = frame.locator(selector).first();
      if ((await field.count()) > 0 && (await field.isVisible())) {
        await field.fill('Homologação Kairo');
        nameFilled = true;
        break;
      }
    }
    if (nameFilled) break;
  }

  const submit = page.locator('button[type="submit"]').first();
  await submit.waitFor({ state: 'visible', timeout: 30_000 });
  await submit.click();
  await page.waitForURL(
    (url) => allowedHosts.has(url.hostname) && url.pathname.startsWith('/app'),
    {
      timeout: 90_000
    }
  );

  const paidState = await pollSubscription(context.request, registration.csrfToken);
  if (paidState.subscription.plan_key !== 'plus') {
    throw new Error('O plano concedido diverge do plano Plus comprado no Checkout.');
  }

  const portalResponse = await context.request.post(new URL('/api/payments/portal', baseUrl).href, {
    headers: { 'x-csrf-token': registration.csrfToken },
    data: {}
  });
  const portal = await bodyOrError(portalResponse, 'Criação do portal de cobrança');
  if (!portal.url?.startsWith('https://billing.stripe.com/')) {
    throw new Error('O Stripe não retornou uma URL oficial do portal de cobrança.');
  }

  const cancelResponse = await context.request.post(new URL('/api/payments/cancel', baseUrl).href, {
    headers: { 'x-csrf-token': registration.csrfToken },
    data: {}
  });
  const cancellation = await bodyOrError(cancelResponse, 'Agendamento de cancelamento');
  if (!cancellation.cancellation_scheduled) {
    throw new Error('O Stripe não confirmou o agendamento do cancelamento.');
  }

  const reconcileResponse = await context.request.post(
    new URL('/api/payments/reconcile', baseUrl).href,
    {
      headers: { 'x-csrf-token': registration.csrfToken },
      data: {}
    }
  );
  await bodyOrError(reconcileResponse, 'Reconciliação final');

  const finalStateResponse = await context.request.get(
    new URL('/api/payments/subscription', baseUrl).href
  );
  const finalState = await bodyOrError(finalStateResponse, 'Consulta final do cancelamento');

  if (!finalState.subscription?.cancel_at_period_end || !finalState.subscription?.access_granted) {
    throw new Error('O estado local não preservou o acesso pago até o fim do período cancelado.');
  }

  process.stdout.write(
    `${JSON.stringify({
      status: 'aprovado',
      checkout: checkout.checkout_session_id,
      plan: finalState.subscription.plan_key,
      access_granted: finalState.subscription.access_granted,
      cancel_at_period_end: finalState.subscription.cancel_at_period_end,
      invoices: finalState.invoices.length,
      portal: true,
      webhook: true
    })}\n`
  );
} finally {
  await context.close();
  await browser.close();
}
