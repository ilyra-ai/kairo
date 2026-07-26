// ============================================================================
// Kairo — Pagamentos Stripe reais, idempotentes e fail-closed (Tarefa 13)
// ============================================================================

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { decryptString, encryptString } from '../../security/crypto.js';
import {
  HttpError,
  badRequest,
  conflict,
  notFound,
  unprocessable
} from '../../shared/http-error.js';
import { ensurePaymentsSchema } from './payments.schema.js';

const PROVIDER = 'stripe';
const SECRET_AAD = 'kairo:payments:stripe:secret:v1';
const WEBHOOK_AAD = 'kairo:payments:stripe:webhook:v1';
const ACCESS_STATUSES = new Set(['active', 'past_due']);
const REVOKED_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired', 'paused', 'expired']);
const SUPPORTED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'charge.dispute.closed'
]);

function invoiceHasSettledPayment(invoice) {
  return invoice?.status === 'paid' || invoice?.paid === true;
}

function defaultStripeClientFactory(secretKey) {
  return new Stripe(secretKey, {
    apiVersion: '2026-06-24.dahlia',
    appInfo: { name: 'Kairo', version: '1.0.0' },
    maxNetworkRetries: 2,
    timeout: 20_000
  });
}

function sqlDateFromUnix(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function objectId(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function normalizedStripeStatus(status) {
  const value = String(status || '').toLowerCase();
  const supported = new Set([
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'unpaid',
    'paused',
    'canceled'
  ]);
  return supported.has(value) ? value : 'incomplete';
}

function safeExternalUrl(value, allowedStripeHost = false) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'https:') return null;
    if (allowedStripeHost) {
      const hostname = parsed.hostname.toLowerCase();
      if (hostname !== 'stripe.com' && !hostname.endsWith('.stripe.com')) return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function validatedBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw unprocessable('Informe uma URL pública absoluta válida.', 'URL_PUBLICA_INVALIDA');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && localHosts.has(parsed.hostname))
  ) {
    throw unprocessable(
      'A URL pública precisa usar HTTPS; HTTP é permitido apenas em localhost.',
      'URL_PUBLICA_INSEGURA'
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.href.replace(/\/$/, '');
}

function asProviderError(error, fallbackMessage = 'O provedor de pagamentos não respondeu.') {
  if (error instanceof HttpError) return error;
  const code = String(error?.code || error?.type || 'PROVEDOR_INDISPONIVEL')
    .replaceAll(/[^A-Za-z0-9_]/g, '_')
    .toUpperCase();
  return new HttpError(503, `STRIPE_${code}`, fallbackMessage, { cause: error, expose: true });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parsePriceMap(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function integrationIdentifier() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const suffix = [...randomBytes(8)].map((byte) => alphabet[byte % alphabet.length]).join('');
  return `kairo_checkout_${suffix}`;
}

function requireStripeSecret(secretKey, mode) {
  const expectedPrefixes = mode === 'live' ? ['rk_live_', 'sk_live_'] : ['rk_test_', 'sk_test_'];
  if (!expectedPrefixes.some((prefix) => String(secretKey || '').startsWith(prefix))) {
    throw unprocessable(
      `A chave privada Stripe precisa corresponder ao modo ${mode === 'live' ? 'produção' : 'teste'}.`,
      'CHAVE_STRIPE_INVALIDA'
    );
  }
}

function requireWebhookSecret(webhookSecret) {
  if (!String(webhookSecret || '').startsWith('whsec_')) {
    throw unprocessable(
      'O segredo do webhook Stripe é obrigatório e precisa iniciar com whsec_.',
      'SEGREDO_WEBHOOK_INVALIDO'
    );
  }
}

export function createPaymentsService({
  db,
  plansService,
  encryptionKey,
  environment = {},
  stripeClientFactory = defaultStripeClientFactory,
  now = () => new Date()
} = {}) {
  if (!db || !plansService || !encryptionKey) {
    throw new Error(
      'O serviço de pagamentos exige banco, serviço de planos e chave-mestra de criptografia.'
    );
  }
  ensurePaymentsSchema(db);

  function paidPlans() {
    return plansService
      .getMatrix()
      .plans.filter((plan) => Number(plan.price) > 0)
      .map((plan) => ({
        key: plan.key,
        name: plan.name,
        description: plan.description,
        price_cents: Number(plan.price),
        price_label: `R$ ${(Number(plan.price) / 100).toFixed(2).replace('.', ',')}`
      }));
  }

  function databaseProviderConfiguration() {
    const row = db.get('SELECT * FROM payment_providers WHERE provider = ?', [PROVIDER]);
    if (!row) return null;
    const prices = Object.fromEntries(
      db
        .all(
          `SELECT plan_key, external_price_id
             FROM payment_plan_prices
            WHERE provider = ? AND mode = ? AND active = 1`,
          [PROVIDER, row.mode]
        )
        .map((item) => [item.plan_key, item.external_price_id])
    );
    return {
      source: 'database',
      enabled: Boolean(row.enabled),
      mode: row.mode,
      secretKey: row.encrypted_secret_key
        ? decryptString(row.encrypted_secret_key, { aad: SECRET_AAD, key: encryptionKey })
        : null,
      webhookSecret: row.encrypted_webhook_secret
        ? decryptString(row.encrypted_webhook_secret, { aad: WEBHOOK_AAD, key: encryptionKey })
        : null,
      publicBaseUrl: row.public_base_url,
      prices
    };
  }

  function effectiveConfiguration() {
    const persisted = databaseProviderConfiguration();
    if (persisted) return persisted;
    return {
      source: 'environment',
      enabled: Boolean(environment.enabled),
      mode: environment.mode === 'live' ? 'live' : 'test',
      secretKey: environment.secretKey || null,
      webhookSecret: environment.webhookSecret || null,
      publicBaseUrl: environment.publicBaseUrl || null,
      prices: parsePriceMap(environment.prices)
    };
  }

  function missingConfiguration(
    configuration,
    { webhook = false, planKey = null, requireEnabled = true } = {}
  ) {
    const missing = [];
    if (requireEnabled && !configuration.enabled) missing.push('provedor desativado');
    if (!configuration.secretKey) missing.push('chave privada ou restrita');
    if (webhook && !configuration.webhookSecret) missing.push('segredo do webhook');
    if (!configuration.publicBaseUrl) missing.push('URL pública');
    if (planKey && !configuration.prices[planKey]) missing.push(`preço Stripe do plano ${planKey}`);
    return missing;
  }

  function stripeContext(options = {}) {
    const configuration = effectiveConfiguration();
    const missing = missingConfiguration(configuration, options);
    if (missing.length > 0) {
      throw new HttpError(
        503,
        'PAGAMENTOS_NAO_CONFIGURADOS',
        'Os pagamentos estão indisponíveis até o administrador concluir a configuração do Stripe.',
        { details: { ausencias: missing } }
      );
    }
    requireStripeSecret(configuration.secretKey, configuration.mode);
    if (options.webhook) requireWebhookSecret(configuration.webhookSecret);
    return {
      configuration,
      stripe: stripeClientFactory(configuration.secretKey)
    };
  }

  function listPlans() {
    const matrix = plansService.getMatrix();
    const configuration = effectiveConfiguration();
    const baseMissing = missingConfiguration(configuration);
    return {
      provider: {
        key: PROVIDER,
        available: baseMissing.length === 0,
        mode: configuration.mode,
        source: configuration.source,
        message:
          baseMissing.length === 0
            ? 'Checkout seguro processado pelo Stripe.'
            : 'Pagamentos temporariamente indisponíveis; procure o administrador.'
      },
      plans: matrix.plans.map((plan) => {
        const payable = Number(plan.price) > 0;
        const mapped = Boolean(configuration.prices[plan.key]);
        return {
          key: plan.key,
          name: plan.name,
          price_cents: Number(plan.price),
          price_label:
            Number(plan.price) > 0
              ? `R$ ${(Number(plan.price) / 100).toFixed(2).replace('.', ',')}`
              : 'Grátis',
          description: plan.description,
          payable,
          checkout_available: payable && mapped && baseMissing.length === 0
        };
      })
    };
  }

  function planForCheckout(planKey) {
    const plan = paidPlans().find((candidate) => candidate.key === planKey);
    if (!plan) {
      const exists = plansService.getMatrix().plans.some((candidate) => candidate.key === planKey);
      if (exists) throw unprocessable('O plano Free não exige pagamento.', 'PLANO_GRATUITO');
      throw notFound('Plano não encontrado.', 'PLANO_NAO_ENCONTRADO');
    }
    return plan;
  }

  function providerPriceMap(configuration = effectiveConfiguration()) {
    return Object.entries(configuration.prices || {}).map(([planKey, priceId]) => ({
      planKey,
      priceId
    }));
  }

  function resolvePlanFromSubscription(subscription, configuration = effectiveConfiguration()) {
    const items = subscription?.items?.data || [];
    const priceIds = new Set(items.map((item) => objectId(item?.price)).filter(Boolean));
    const match = providerPriceMap(configuration).find(({ priceId }) => priceIds.has(priceId));
    if (!match) {
      throw unprocessable(
        'A assinatura recebida usa um preço Stripe não mapeado no Kairo.',
        'PRECO_STRIPE_NAO_MAPEADO'
      );
    }
    const matchedItem = items.find((item) => objectId(item?.price) === match.priceId);
    const price = matchedItem?.price;
    if (
      Number(matchedItem?.quantity || 0) !== 1 ||
      !price ||
      String(price.currency || '').toLowerCase() !== 'brl' ||
      Number(price.unit_amount) !== Number(planForCheckout(match.planKey).price_cents) ||
      price.type !== 'recurring' ||
      price.recurring?.interval !== 'month' ||
      (typeof price?.livemode === 'boolean' && price.livemode !== (configuration.mode === 'live'))
    ) {
      throw unprocessable(
        'A quantidade ou o ambiente do preço Stripe diverge da configuração do Kairo.',
        'ASSINATURA_STRIPE_DIVERGENTE'
      );
    }
    return { planKey: match.planKey, priceId: match.priceId };
  }

  function userForProviderObject(object, localCustomerId = null) {
    const mode = effectiveConfiguration().mode;
    const metadataUserId = Number(object?.metadata?.kairo_user_id);
    if (Number.isSafeInteger(metadataUserId) && metadataUserId > 0) {
      const user = db.get(
        'SELECT id, name, email, plan FROM users WHERE id = ? AND is_active = 1',
        [metadataUserId]
      );
      if (user) return user;
    }
    const customerId = objectId(object?.customer) || localCustomerId;
    if (!customerId) return null;
    return db.get(
      `SELECT users.id, users.name, users.email, users.plan
         FROM payment_customers
         JOIN users ON users.id = payment_customers.user_id
        WHERE payment_customers.provider = ?
          AND payment_customers.mode = ?
          AND payment_customers.external_customer_id = ?
          AND users.is_active = 1`,
      [PROVIDER, mode, customerId]
    );
  }

  function applyEntitlement(userId) {
    const mode = effectiveConfiguration().mode;
    const entitled = db.get(
      `SELECT subscriptions.id, subscriptions.plan_key
         FROM subscriptions
        WHERE subscriptions.user_id = ?
          AND subscriptions.provider = ?
          AND subscriptions.mode = ?
          AND subscriptions.access_granted = 1
          AND (
            subscriptions.status = 'active'
            OR (
              subscriptions.status = 'past_due'
              AND subscriptions.current_period_end IS NOT NULL
              AND subscriptions.current_period_end > ?
            )
          )
        ORDER BY COALESCE(subscriptions.access_granted_at, subscriptions.updated_at) DESC,
                 subscriptions.id DESC
        LIMIT 1`,
      [userId, PROVIDER, mode, now().toISOString()]
    );
    const planKey = entitled?.plan_key || 'free';
    const result = db.run("UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?", [
      planKey,
      userId
    ]);
    if (result.changes === 0) throw notFound('Usuário não encontrado.', 'USUARIO_NAO_ENCONTRADO');
    return { user_id: userId, plan: planKey, subscription_id: entitled?.id || null };
  }

  function syncSubscription(
    subscription,
    eventCreated,
    { grantAccess = false, authoritative = false } = {}
  ) {
    const configuration = effectiveConfiguration();
    const user = userForProviderObject(subscription);
    if (!user) {
      throw notFound(
        'Não foi possível vincular a assinatura Stripe a um usuário ativo.',
        'CLIENTE_NAO_VINCULADO'
      );
    }
    const customerId = objectId(subscription.customer);
    const externalSubscriptionId = objectId(subscription);
    const { planKey, priceId } = resolvePlanFromSubscription(subscription, configuration);
    const plan = planForCheckout(planKey);
    const subscriptionItem = (subscription?.items?.data || []).find(
      (item) => objectId(item?.price) === priceId
    );
    const providerCreated = Number(eventCreated || 0);
    const existing = db.get(
      'SELECT * FROM subscriptions WHERE provider = ? AND mode = ? AND external_subscription_id = ?',
      [PROVIDER, configuration.mode, externalSubscriptionId]
    );
    if (
      !authoritative &&
      existing &&
      providerCreated > 0 &&
      providerCreated < existing.last_provider_event_created
    ) {
      return { row: existing, user, ignoredAsStale: true };
    }

    const reference =
      existing?.external_ref ||
      subscription.metadata?.kairo_checkout_reference ||
      `stripe-subscription-${externalSubscriptionId}`;
    const status = normalizedStripeStatus(subscription.status);
    const shouldRevoke = REVOKED_STATUSES.has(status);
    const sameCommercialPlan =
      existing?.plan_key === planKey && existing?.external_price_id === priceId;
    const accessGranted = shouldRevoke
      ? 0
      : grantAccess && ACCESS_STATUSES.has(status)
        ? 1
        : sameCommercialPlan
          ? Number(existing?.access_granted || 0)
          : 0;
    const accessGrantedAt =
      accessGranted === 1
        ? grantAccess
          ? now().toISOString()
          : existing?.access_granted_at || null
        : null;

    const periodStart = sqlDateFromUnix(subscriptionItem?.current_period_start);
    const periodEnd = sqlDateFromUnix(subscriptionItem?.current_period_end);
    if (existing) {
      db.run(
        `UPDATE subscriptions SET
           user_id = ?, plan_key = ?, status = ?, mode = ?, external_customer_id = ?,
           external_price_id = ?, amount_cents = ?, currency = 'brl',
           current_period_start = ?, current_period_end = ?, cancel_at_period_end = ?,
           access_granted = ?, access_granted_at = ?, last_provider_event_created = ?,
           latest_invoice_id = COALESCE(?, latest_invoice_id), updated_at = datetime('now')
         WHERE id = ?`,
        [
          user.id,
          planKey,
          status,
          configuration.mode,
          customerId,
          priceId,
          plan.price_cents,
          periodStart,
          periodEnd,
          subscription.cancel_at_period_end ? 1 : 0,
          accessGranted,
          accessGrantedAt,
          Math.max(providerCreated, Number(existing.last_provider_event_created || 0)),
          objectId(subscription.latest_invoice),
          existing.id
        ]
      );
    } else {
      db.run(
        `INSERT INTO subscriptions
           (user_id, plan_key, status, provider, mode, external_ref, external_subscription_id,
            external_customer_id, external_price_id, amount_cents, currency,
            current_period_start, current_period_end, cancel_at_period_end,
            access_granted, access_granted_at, last_provider_event_created,
            latest_invoice_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'brl', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          user.id,
          planKey,
          status,
          PROVIDER,
          configuration.mode,
          reference,
          externalSubscriptionId,
          customerId,
          priceId,
          plan.price_cents,
          periodStart,
          periodEnd,
          subscription.cancel_at_period_end ? 1 : 0,
          accessGranted,
          accessGrantedAt,
          providerCreated,
          objectId(subscription.latest_invoice)
        ]
      );
    }
    const row = db.get(
      'SELECT * FROM subscriptions WHERE provider = ? AND mode = ? AND external_subscription_id = ?',
      [PROVIDER, configuration.mode, externalSubscriptionId]
    );
    applyEntitlement(user.id);
    return { row, user, ignoredAsStale: false };
  }

  async function getOrCreateCustomer(stripe, user) {
    const configuration = effectiveConfiguration();
    const existing = db.get(
      'SELECT * FROM payment_customers WHERE user_id = ? AND provider = ? AND mode = ?',
      [user.id, PROVIDER, configuration.mode]
    );
    if (existing) return existing.external_customer_id;
    let customer;
    try {
      customer = await stripe.customers.create(
        {
          name: user.name,
          email: user.email,
          metadata: { kairo_user_id: String(user.id) }
        },
        { idempotencyKey: `kairo-customer-${user.id}` }
      );
    } catch (error) {
      throw asProviderError(error, 'Não foi possível criar o cliente no Stripe.');
    }
    db.run(
      `INSERT INTO payment_customers (user_id, provider, mode, external_customer_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         mode = excluded.mode,
         external_customer_id = excluded.external_customer_id,
         updated_at = datetime('now')`,
      [user.id, PROVIDER, configuration.mode, customer.id]
    );
    return customer.id;
  }

  async function createCheckout(userId, input = {}) {
    const plan = planForCheckout(input.plan_key);
    const { configuration, stripe } = stripeContext({ planKey: plan.key });
    const existingAccess = db.get(
      `SELECT id, plan_key, status, cancel_at_period_end
         FROM subscriptions
        WHERE user_id = ? AND provider = ? AND mode = ? AND access_granted = 1
          AND status IN ('active', 'trialing', 'past_due')
        ORDER BY id DESC LIMIT 1`,
      [userId, PROVIDER, configuration.mode]
    );
    if (existingAccess) {
      throw conflict(
        'Você já possui uma assinatura. Use o portal de cobrança para gerenciá-la.',
        'ASSINATURA_JA_EXISTE'
      );
    }
    const user = db.get('SELECT id, name, email FROM users WHERE id = ? AND is_active = 1', [
      userId
    ]);
    if (!user) throw notFound('Usuário não encontrado.', 'USUARIO_NAO_ENCONTRADO');

    db.run(
      `UPDATE checkout_sessions
          SET status = 'failed', failure_code = 'creation_timeout', updated_at = datetime('now')
        WHERE user_id = ? AND provider = ? AND mode = ? AND status = 'creating'
          AND created_at <= datetime('now', '-5 minutes')`,
      [userId, PROVIDER, configuration.mode]
    );
    db.run(
      `UPDATE checkout_sessions
          SET status = 'expired', updated_at = datetime('now')
        WHERE user_id = ? AND provider = ? AND mode = ? AND status = 'open'
          AND (expires_at IS NULL OR expires_at <= ?)`,
      [userId, PROVIDER, configuration.mode, now().toISOString()]
    );
    const reusable = db.get(
      `SELECT * FROM checkout_sessions
        WHERE user_id = ? AND provider = ? AND mode = ? AND status IN ('creating', 'open')
        ORDER BY created_at DESC LIMIT 1`,
      [userId, PROVIDER, configuration.mode]
    );
    if (reusable?.plan_key === plan.key && reusable?.checkout_url) {
      return {
        provider: PROVIDER,
        checkout_id: reusable.id,
        checkout_session_id: reusable.external_session_id,
        url: reusable.checkout_url,
        expires_at: reusable.expires_at,
        reused: true
      };
    }
    if (reusable?.external_session_id) {
      try {
        await stripe.checkout.sessions.expire(reusable.external_session_id);
        db.run(
          `UPDATE checkout_sessions
              SET status = 'expired', failure_code = 'superseded_checkout',
                  updated_at = datetime('now')
            WHERE id = ?`,
          [reusable.id]
        );
      } catch (error) {
        throw asProviderError(
          error,
          'O checkout anterior ainda está em processamento e não pôde ser encerrado com segurança.'
        );
      }
    } else if (reusable) {
      throw conflict(
        'Já existe um checkout sendo criado para sua conta. Aguarde alguns instantes.',
        'CHECKOUT_EM_PROCESSAMENTO'
      );
    }

    const checkoutId = randomUUID();
    const idempotencyKey = `kairo-checkout-${checkoutId}`;
    db.run(
      `INSERT INTO checkout_sessions
         (id, user_id, plan_key, provider, mode, idempotency_key, status)
       VALUES (?, ?, ?, ?, ?, ?, 'creating')`,
      [checkoutId, userId, plan.key, PROVIDER, configuration.mode, idempotencyKey]
    );

    try {
      const customerId = await getOrCreateCustomer(stripe, user);
      const metadata = {
        kairo_user_id: String(user.id),
        kairo_plan_key: plan.key,
        kairo_checkout_reference: checkoutId
      };
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          integration_identifier: integrationIdentifier(),
          customer: customerId,
          client_reference_id: checkoutId,
          line_items: [{ price: configuration.prices[plan.key], quantity: 1 }],
          success_url: `${validatedBaseUrl(configuration.publicBaseUrl)}/app/?pagamento=sucesso&sessao={CHECKOUT_SESSION_ID}`,
          cancel_url: `${validatedBaseUrl(configuration.publicBaseUrl)}/app/?pagamento=cancelado`,
          locale: 'pt-BR',
          metadata,
          subscription_data: { metadata }
        },
        { idempotencyKey }
      );
      const checkoutUrl = safeExternalUrl(session.url, true);
      if (!checkoutUrl) throw new Error('O Stripe não retornou uma URL de checkout HTTPS válida.');
      const expiresAt = sqlDateFromUnix(session.expires_at);
      db.run(
        `UPDATE checkout_sessions
            SET external_session_id = ?, status = 'open', checkout_url = ?, expires_at = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
        [session.id, checkoutUrl, expiresAt, checkoutId]
      );
      return {
        provider: PROVIDER,
        checkout_id: checkoutId,
        checkout_session_id: session.id,
        url: checkoutUrl,
        expires_at: expiresAt,
        reused: false
      };
    } catch (error) {
      db.run(
        `UPDATE checkout_sessions
            SET status = 'failed', failure_code = ?, updated_at = datetime('now')
          WHERE id = ?`,
        [String(error?.code || error?.type || 'stripe_error').slice(0, 100), checkoutId]
      );
      throw asProviderError(error, 'Não foi possível abrir o checkout seguro do Stripe.');
    }
  }

  function getSubscription(userId) {
    const configuration = effectiveConfiguration();
    return (
      db.get(
        `SELECT id, plan_key, status, provider, amount_cents, currency,
                current_period_start, current_period_end, cancel_at_period_end,
                access_granted, updated_at
           FROM subscriptions
          WHERE user_id = ? AND provider = ? AND mode = ?
          ORDER BY COALESCE(access_granted_at, updated_at) DESC, id DESC LIMIT 1`,
        [userId, PROVIDER, configuration.mode]
      ) || null
    );
  }

  function listInvoices(userId) {
    const configuration = effectiveConfiguration();
    return db.all(
      `SELECT external_invoice_id, status, currency, amount_due_cents, amount_paid_cents,
              hosted_invoice_url, invoice_pdf_url, period_start, period_end, created_at
         FROM invoices_or_receipts
        WHERE user_id = ? AND provider = ? AND mode = ? ORDER BY created_at DESC LIMIT 24`,
      [userId, PROVIDER, configuration.mode]
    );
  }

  async function createPortal(userId) {
    const { configuration, stripe } = stripeContext({ requireEnabled: false });
    const customer = db.get(
      'SELECT external_customer_id FROM payment_customers WHERE user_id = ? AND provider = ? AND mode = ?',
      [userId, PROVIDER, configuration.mode]
    );
    if (!customer) {
      throw unprocessable(
        'Nenhum perfil de cobrança foi encontrado.',
        'CLIENTE_STRIPE_INEXISTENTE'
      );
    }
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customer.external_customer_id,
        return_url: `${validatedBaseUrl(configuration.publicBaseUrl)}/app/`
      });
      const url = safeExternalUrl(session.url, true);
      if (!url) throw new Error('O Stripe não retornou uma URL de portal HTTPS válida.');
      return { provider: PROVIDER, url };
    } catch (error) {
      throw asProviderError(error, 'Não foi possível abrir o portal de cobrança do Stripe.');
    }
  }

  async function cancel(userId) {
    const configuration = effectiveConfiguration();
    const current = db.get(
      `SELECT * FROM subscriptions
        WHERE user_id = ? AND provider = ? AND mode = ? AND access_granted = 1
          AND status IN ('active', 'trialing', 'past_due')
        ORDER BY id DESC LIMIT 1`,
      [userId, PROVIDER, configuration.mode]
    );
    if (!current?.external_subscription_id) {
      throw unprocessable('Nenhuma assinatura ativa para cancelar.', 'SEM_ASSINATURA_ATIVA');
    }
    const { stripe } = stripeContext({ requireEnabled: false });
    try {
      const subscription = await stripe.subscriptions.update(current.external_subscription_id, {
        cancel_at_period_end: true
      });
      const synced = syncSubscription(subscription, Math.floor(now().getTime() / 1000));
      return {
        cancellation_scheduled: true,
        plan_key: synced.row.plan_key,
        current_period_end: synced.row.current_period_end,
        access_granted: Boolean(synced.row.access_granted)
      };
    } catch (error) {
      throw asProviderError(
        error,
        'O cancelamento não foi confirmado pelo Stripe; sua assinatura não foi alterada.'
      );
    }
  }

  async function reconcileCheckoutSession(userId, checkoutSessionId, stripe) {
    const configuration = effectiveConfiguration();
    const localCheckout = db.get(
      `SELECT * FROM checkout_sessions
        WHERE user_id = ? AND provider = ? AND mode = ? AND external_session_id = ?`,
      [userId, PROVIDER, configuration.mode, checkoutSessionId]
    );
    if (!localCheckout) {
      throw notFound('Sessão de checkout não vinculada à sua conta.', 'CHECKOUT_NAO_VINCULADO');
    }

    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
        expand: ['subscription.latest_invoice']
      });
    } catch (error) {
      throw asProviderError(error, 'Não foi possível confirmar o checkout no Stripe.');
    }

    const reference =
      checkoutSession.metadata?.kairo_checkout_reference || checkoutSession.client_reference_id;
    const metadataUserId = Number(checkoutSession.metadata?.kairo_user_id);
    const knownCustomer = db.get(
      `SELECT external_customer_id FROM payment_customers
        WHERE user_id = ? AND provider = ? AND mode = ?`,
      [userId, PROVIDER, configuration.mode]
    );
    if (
      checkoutSession.mode !== 'subscription' ||
      reference !== localCheckout.id ||
      metadataUserId !== userId ||
      objectId(checkoutSession.customer) !== knownCustomer?.external_customer_id
    ) {
      throw badRequest(
        'A sessão retornada pelo Stripe diverge do checkout iniciado.',
        'CHECKOUT_DIVERGENTE'
      );
    }
    if (checkoutSession.status !== 'complete') {
      return {
        checkout_session_id: checkoutSessionId,
        confirmed: false,
        status: checkoutSession.status
      };
    }

    let subscription = checkoutSession.subscription;
    if (typeof subscription === 'string') {
      subscription = await stripe.subscriptions.retrieve(subscription, {
        expand: ['latest_invoice']
      });
    }
    if (!subscription) {
      throw unprocessable(
        'O Stripe ainda não vinculou uma assinatura ao checkout.',
        'ASSINATURA_PENDENTE'
      );
    }
    const latestInvoice =
      subscription.latest_invoice && typeof subscription.latest_invoice === 'object'
        ? subscription.latest_invoice
        : null;
    const grantAccess =
      invoiceHasSettledPayment(latestInvoice) && ACCESS_STATUSES.has(subscription.status);
    const synced = syncSubscription(subscription, Math.floor(now().getTime() / 1000), {
      grantAccess
    });
    if (latestInvoice) upsertInvoice(latestInvoice, synced);
    db.run(
      `UPDATE checkout_sessions
          SET status = 'complete', updated_at = datetime('now')
        WHERE id = ?`,
      [localCheckout.id]
    );
    return {
      checkout_session_id: checkoutSessionId,
      confirmed: grantAccess,
      status: synced.row.status,
      plan_key: synced.row.plan_key
    };
  }

  async function reconcileUser(userId, input = {}) {
    const configuration = effectiveConfiguration();
    const { stripe } = stripeContext({ requireEnabled: false });
    const checkout = input.checkout_session_id
      ? await reconcileCheckoutSession(userId, input.checkout_session_id, stripe)
      : null;
    const rows = db.all(
      `SELECT * FROM subscriptions
        WHERE user_id = ? AND provider = ? AND mode = ? AND external_subscription_id IS NOT NULL
        ORDER BY id DESC`,
      [userId, PROVIDER, configuration.mode]
    );
    const reconciled = [];
    for (const row of rows) {
      try {
        const subscription = await stripe.subscriptions.retrieve(row.external_subscription_id, {
          expand: ['latest_invoice']
        });
        const latestInvoice =
          subscription.latest_invoice && typeof subscription.latest_invoice === 'object'
            ? subscription.latest_invoice
            : null;
        const grantAccess =
          invoiceHasSettledPayment(latestInvoice) && ACCESS_STATUSES.has(subscription.status);
        const result = syncSubscription(subscription, Math.floor(now().getTime() / 1000), {
          grantAccess
        });
        reconciled.push({ id: row.id, status: result.row.status, corrected: true });
      } catch (error) {
        if (error?.code === 'resource_missing') {
          db.run(
            `UPDATE subscriptions
                SET status = 'canceled', access_granted = 0, access_granted_at = NULL,
                    failure_code = 'resource_missing', updated_at = datetime('now')
              WHERE id = ?`,
            [row.id]
          );
          reconciled.push({ id: row.id, status: 'canceled', corrected: true });
          continue;
        }
        throw asProviderError(error, 'A reconciliação com o Stripe não foi concluída.');
      }
    }
    applyEntitlement(userId);
    return { user_id: userId, checkout, reconciled };
  }

  function registerWebhookEvent(event, rawBody) {
    const mode = effectiveConfiguration().mode;
    const existing = db.get(
      'SELECT * FROM webhook_events WHERE provider = ? AND mode = ? AND event_id = ?',
      [PROVIDER, mode, event.id]
    );
    if (existing?.processing_status === 'processed') {
      return { duplicate: true, row: existing };
    }
    if (existing?.processing_status === 'processing') {
      const updatedAt = new Date(`${String(existing.updated_at).replace(' ', 'T')}Z`).getTime();
      if (Number.isFinite(updatedAt) && now().getTime() - updatedAt < 5 * 60 * 1000) {
        return { duplicate: true, inProgress: true, row: existing };
      }
    }
    const payloadHash = sha256(rawBody);
    if (existing) {
      db.run(
        `UPDATE webhook_events
            SET processing_status = 'processing', attempts = attempts + 1,
                payload_sha256 = ?, error_code = NULL, error_message = NULL,
                updated_at = datetime('now')
          WHERE id = ?`,
        [payloadHash, existing.id]
      );
      return { duplicate: false, row: { ...existing, payload_sha256: payloadHash } };
    }
    const result = db.run(
      `INSERT INTO webhook_events
         (provider, mode, event_id, event_type, processing_status, payload_sha256, provider_created_at)
       VALUES (?, ?, ?, ?, 'processing', ?, ?)`,
      [PROVIDER, mode, event.id, event.type, payloadHash, Number(event.created || 0)]
    );
    return { duplicate: false, row: { id: result.lastID } };
  }

  function recordPaymentEvent(event, data = {}) {
    const mode = effectiveConfiguration().mode;
    db.run(
      `INSERT OR IGNORE INTO payment_events
         (provider, event_id, type, subscription_id, detail, user_id,
          external_object_id, amount_cents, currency, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        PROVIDER,
        event.id,
        event.type,
        data.subscriptionId || null,
        JSON.stringify({ effect: data.effect || 'registrado', status: data.status || null }),
        data.userId || null,
        data.externalObjectId || null,
        Number.isFinite(Number(data.amountCents)) ? Number(data.amountCents) : null,
        data.currency || null,
        mode
      ]
    );
  }

  function subscriptionIdFromInvoice(invoice) {
    return (
      objectId(invoice.subscription) ||
      objectId(invoice.parent?.subscription_details?.subscription) ||
      objectId(invoice.lines?.data?.[0]?.parent?.subscription_item_details?.subscription)
    );
  }

  function upsertInvoice(invoice, synced) {
    const invoiceId = objectId(invoice);
    if (!invoiceId || !synced?.user?.id) return;
    db.run(
      `INSERT INTO invoices_or_receipts
         (user_id, subscription_id, provider, external_invoice_id, external_customer_id,
          mode, status, currency, amount_due_cents, amount_paid_cents, hosted_invoice_url,
          invoice_pdf_url, period_start, period_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (provider, external_invoice_id) DO UPDATE SET
         status = excluded.status,
         amount_due_cents = excluded.amount_due_cents,
         amount_paid_cents = excluded.amount_paid_cents,
         hosted_invoice_url = excluded.hosted_invoice_url,
         invoice_pdf_url = excluded.invoice_pdf_url,
         period_start = excluded.period_start,
         period_end = excluded.period_end,
         updated_at = datetime('now')`,
      [
        synced.user.id,
        synced.row.id,
        PROVIDER,
        invoiceId,
        objectId(invoice.customer),
        effectiveConfiguration().mode,
        String(invoice.status || 'desconhecido'),
        String(invoice.currency || 'brl').toLowerCase(),
        Math.max(0, Number(invoice.amount_due || 0)),
        Math.max(0, Number(invoice.amount_paid || 0)),
        safeExternalUrl(invoice.hosted_invoice_url),
        safeExternalUrl(invoice.invoice_pdf),
        sqlDateFromUnix(invoice.period_start),
        sqlDateFromUnix(invoice.period_end)
      ]
    );
    db.run('UPDATE subscriptions SET latest_invoice_id = ? WHERE id = ?', [
      invoiceId,
      synced.row.id
    ]);
  }

  async function financialContextFromCharge(stripe, chargeValue) {
    const chargeId = objectId(chargeValue);
    if (!chargeId) {
      throw badRequest('Evento financeiro sem cobrança vinculada.', 'COBRANCA_NAO_VINCULADA');
    }
    const charge =
      typeof chargeValue === 'object' && chargeValue.invoice
        ? chargeValue
        : await stripe.charges.retrieve(chargeId);
    let invoice = charge.invoice;
    if (typeof invoice === 'string') {
      invoice = await stripe.invoices.retrieve(invoice);
    }
    const externalSubscriptionId = subscriptionIdFromInvoice(invoice);
    if (!invoice || !externalSubscriptionId) {
      throw badRequest(
        'A cobrança não pertence a uma fatura de assinatura do Kairo.',
        'COBRANCA_FORA_DE_ASSINATURA'
      );
    }
    const subscription = await stripe.subscriptions.retrieve(externalSubscriptionId);
    return { charge, invoice, subscription };
  }

  async function processRefundOrDispute(event, stripe) {
    const object = event.data.object;
    const isChargeRefund = event.type === 'charge.refunded';
    const isRefund = isChargeRefund || event.type.startsWith('refund.');
    const chargeValue = isChargeRefund ? object : object.charge;
    const context = await financialContextFromCharge(stripe, chargeValue);
    const isLatestInvoice =
      objectId(context.subscription.latest_invoice) === objectId(context.invoice);
    const restoreWonDispute =
      event.type === 'charge.dispute.closed' &&
      object.status === 'won' &&
      isLatestInvoice &&
      invoiceHasSettledPayment(context.invoice);
    const synced = syncSubscription(context.subscription, event.created, {
      grantAccess: restoreWonDispute,
      authoritative: true
    });
    upsertInvoice(context.invoice, synced);

    let effect = 'evento_financeiro_registrado';
    let suspensionReason = null;
    if (!isLatestInvoice) {
      effect = 'evento_financeiro_historico';
    } else if (isRefund) {
      const fullRefund =
        Boolean(context.charge.refunded) ||
        (Number(context.charge.amount) > 0 &&
          Number(context.charge.amount_refunded) >= Number(context.charge.amount));
      const refundSucceeded = isChargeRefund || object.status === 'succeeded';
      if (fullRefund && refundSucceeded) {
        suspensionReason = 'payment_fully_refunded';
        effect = 'acesso_suspenso_por_estorno_integral';
      } else {
        effect = event.type === 'refund.failed' ? 'estorno_falhou' : 'estorno_parcial_registrado';
      }
    } else if (event.type === 'charge.dispute.created') {
      suspensionReason = 'payment_disputed';
      effect = 'acesso_suspenso_por_disputa';
    } else if (event.type === 'charge.dispute.closed') {
      if (object.status === 'won') {
        effect = restoreWonDispute
          ? 'acesso_restaurado_apos_disputa'
          : 'disputa_vencida_registrada';
      } else if (object.status === 'lost') {
        suspensionReason = 'payment_dispute_lost';
        effect = 'acesso_suspenso_por_disputa_perdida';
      } else {
        effect = 'disputa_encerrada_registrada';
      }
    }

    if (suspensionReason) {
      db.run(
        `UPDATE subscriptions
            SET access_granted = 0, access_granted_at = NULL, failure_code = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
        [suspensionReason, synced.row.id]
      );
      applyEntitlement(synced.user.id);
    }
    recordPaymentEvent(event, {
      subscriptionId: synced.row.id,
      userId: synced.user.id,
      externalObjectId: objectId(object),
      amountCents: isRefund ? object.amount || context.charge.amount_refunded : object.amount,
      currency: object.currency || context.charge.currency,
      status: suspensionReason || object.status,
      effect
    });
    return { effect };
  }

  async function processWebhookEvent(event, stripe) {
    const object = event.data.object;
    if (!SUPPORTED_EVENTS.has(event.type)) {
      recordPaymentEvent(event, { externalObjectId: objectId(object), effect: 'ignorado' });
      return { effect: 'evento_nao_utilizado' };
    }

    if (
      event.type === 'charge.refunded' ||
      event.type.startsWith('refund.') ||
      event.type.startsWith('charge.dispute.')
    ) {
      return processRefundOrDispute(event, stripe);
    }

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      if (object.mode !== 'subscription') {
        throw badRequest('Sessão Stripe não corresponde a uma assinatura.', 'CHECKOUT_INVALIDO');
      }
      const reference = object.metadata?.kairo_checkout_reference || object.client_reference_id;
      const checkout = db.get('SELECT * FROM checkout_sessions WHERE id = ?', [reference]);
      if (!checkout || Number(object.metadata?.kairo_user_id) !== checkout.user_id) {
        throw notFound('Checkout Stripe não vinculado ao Kairo.', 'CHECKOUT_NAO_VINCULADO');
      }
      db.run(
        `UPDATE checkout_sessions
            SET external_session_id = ?, status = 'complete', updated_at = datetime('now')
          WHERE id = ?`,
        [object.id, checkout.id]
      );
      const externalSubscriptionId = objectId(object.subscription);
      let synced = null;
      if (externalSubscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(externalSubscriptionId);
        synced = syncSubscription(subscription, event.created, { grantAccess: false });
      }
      recordPaymentEvent(event, {
        subscriptionId: synced?.row?.id,
        userId: checkout.user_id,
        externalObjectId: object.id,
        effect: 'checkout_confirmado_sem_concessao'
      });
      return { effect: 'checkout_confirmado' };
    }

    if (event.type === 'checkout.session.async_payment_failed') {
      const reference = object.metadata?.kairo_checkout_reference || object.client_reference_id;
      db.run(
        `UPDATE checkout_sessions
            SET status = 'failed', failure_code = 'async_payment_failed',
                updated_at = datetime('now')
          WHERE id = ? OR external_session_id = ?`,
        [reference || '', object.id]
      );
      recordPaymentEvent(event, {
        externalObjectId: object.id,
        effect: 'pagamento_assincrono_falhou'
      });
      return { effect: 'pagamento_assincrono_falhou' };
    }

    if (event.type === 'checkout.session.expired') {
      const reference = object.metadata?.kairo_checkout_reference || object.client_reference_id;
      db.run(
        `UPDATE checkout_sessions
            SET status = 'expired', updated_at = datetime('now')
          WHERE id = ? OR external_session_id = ?`,
        [reference || '', object.id]
      );
      recordPaymentEvent(event, {
        externalObjectId: object.id,
        effect: 'checkout_expirado'
      });
      return { effect: 'checkout_expirado' };
    }

    if (event.type.startsWith('customer.subscription.')) {
      const synced = syncSubscription(object, event.created, { grantAccess: false });
      recordPaymentEvent(event, {
        subscriptionId: synced.row.id,
        userId: synced.user.id,
        externalObjectId: object.id,
        status: synced.row.status,
        effect: synced.ignoredAsStale ? 'evento_antigo_ignorado' : 'assinatura_sincronizada'
      });
      return {
        effect: synced.ignoredAsStale ? 'evento_antigo_ignorado' : 'assinatura_sincronizada'
      };
    }

    const externalSubscriptionId = subscriptionIdFromInvoice(object);
    if (!externalSubscriptionId) {
      throw badRequest('Fatura Stripe sem vínculo de assinatura.', 'FATURA_SEM_ASSINATURA');
    }
    const subscription = await stripe.subscriptions.retrieve(externalSubscriptionId);
    const isLatestInvoice = objectId(subscription.latest_invoice) === objectId(object);
    const grantAccess =
      isLatestInvoice && event.type === 'invoice.paid' && invoiceHasSettledPayment(object);
    const synced = syncSubscription(subscription, event.created, {
      grantAccess,
      authoritative: true
    });
    if (grantAccess && String(object.currency || '').toLowerCase() !== 'brl') {
      db.run(
        `UPDATE subscriptions
            SET access_granted = 0, access_granted_at = NULL,
                failure_code = 'invoice_currency_mismatch', updated_at = datetime('now')
          WHERE id = ?`,
        [synced.row.id]
      );
      applyEntitlement(synced.user.id);
      throw unprocessable(
        'A moeda da fatura paga diverge da configuração do plano.',
        'MOEDA_FATURA_DIVERGENTE'
      );
    }
    if (
      isLatestInvoice &&
      ['invoice.voided', 'invoice.marked_uncollectible'].includes(event.type)
    ) {
      db.run(
        `UPDATE subscriptions
            SET access_granted = 0, access_granted_at = NULL,
                failure_code = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
        [
          event.type === 'invoice.voided' ? 'invoice_voided' : 'invoice_uncollectible',
          synced.row.id
        ]
      );
      applyEntitlement(synced.user.id);
      synced.row = db.get('SELECT * FROM subscriptions WHERE id = ?', [synced.row.id]);
    }
    upsertInvoice(object, synced);
    recordPaymentEvent(event, {
      subscriptionId: synced.row.id,
      userId: synced.user.id,
      externalObjectId: object.id,
      amountCents: object.amount_paid,
      currency: object.currency,
      status: synced.row.status,
      effect: !isLatestInvoice
        ? 'fatura_historica_registrada'
        : event.type === 'invoice.paid'
          ? 'acesso_concedido'
          : event.type === 'invoice.payment_failed'
            ? 'falha_registrada'
            : 'acesso_revogado'
    });
    return {
      effect: !isLatestInvoice
        ? 'fatura_historica_registrada'
        : event.type === 'invoice.paid'
          ? 'acesso_concedido'
          : event.type === 'invoice.payment_failed'
            ? 'falha_registrada'
            : 'acesso_revogado'
    };
  }

  async function handleStripeWebhook(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody)) {
      throw badRequest('O webhook exige o corpo bruto da requisição.', 'CORPO_WEBHOOK_INVALIDO');
    }
    const { configuration, stripe } = stripeContext({ webhook: true, requireEnabled: false });
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, configuration.webhookSecret);
    } catch {
      throw badRequest('Assinatura Stripe inválida.', 'ASSINATURA_STRIPE_INVALIDA');
    }
    if (Boolean(event.livemode) !== (configuration.mode === 'live')) {
      throw badRequest(
        'O modo do evento Stripe não corresponde à configuração.',
        'MODO_STRIPE_DIVERGENTE'
      );
    }
    const registration = registerWebhookEvent(event, rawBody);
    if (registration.inProgress) {
      throw conflict(
        'O evento Stripe ainda está sendo processado; uma nova tentativa será necessária.',
        'EVENTO_STRIPE_EM_PROCESSAMENTO'
      );
    }
    if (registration.duplicate) {
      return { processed: false, duplicate: true, event_id: event.id };
    }
    try {
      const result = await processWebhookEvent(event, stripe);
      db.run(
        `UPDATE webhook_events
            SET processing_status = 'processed', processed_at = ?, updated_at = datetime('now')
          WHERE provider = ? AND mode = ? AND event_id = ?`,
        [now().toISOString(), PROVIDER, configuration.mode, event.id]
      );
      return { processed: true, duplicate: false, event_id: event.id, effect: result.effect };
    } catch (error) {
      db.run(
        `UPDATE webhook_events
            SET processing_status = 'failed', error_code = ?, error_message = ?,
                updated_at = datetime('now')
          WHERE provider = ? AND mode = ? AND event_id = ?`,
        [
          String(error?.code || 'PROCESSAMENTO_FALHOU').slice(0, 100),
          String(error?.message || 'Falha no processamento.').slice(0, 300),
          PROVIDER,
          configuration.mode,
          event.id
        ]
      );
      throw error;
    }
  }

  async function validateStripeConfiguration(configuration) {
    const mode = configuration.mode === 'live' ? 'live' : 'test';
    requireStripeSecret(configuration.secretKey, mode);
    requireWebhookSecret(configuration.webhookSecret);
    const publicBaseUrl = validatedBaseUrl(configuration.publicBaseUrl);
    const priceMap = parsePriceMap(configuration.prices);
    const expectedPlans = paidPlans();
    const missingPlans = expectedPlans.filter((plan) => !priceMap[plan.key]);
    if (missingPlans.length > 0) {
      throw unprocessable(
        'Todos os planos pagos precisam de um Price ID Stripe.',
        'PRECOS_STRIPE_INCOMPLETOS',
        missingPlans.map((plan) => plan.key)
      );
    }
    const stripe = stripeClientFactory(configuration.secretKey);
    try {
      const account = await stripe.accounts.retrieve();
      const validatedPrices = [];
      for (const plan of expectedPlans) {
        const priceId = String(priceMap[plan.key] || '');
        if (!priceId.startsWith('price_')) {
          throw unprocessable(`Price ID inválido para ${plan.name}.`, 'PRICE_ID_INVALIDO');
        }
        const price = await stripe.prices.retrieve(priceId);
        if (
          !price.active ||
          price.type !== 'recurring' ||
          price.currency !== 'brl' ||
          price.recurring?.interval !== 'month' ||
          Number(price.unit_amount) !== plan.price_cents
        ) {
          throw unprocessable(
            `O preço Stripe de ${plan.name} precisa estar ativo, mensal, em BRL e valer ${plan.price_label}.`,
            'PRECO_STRIPE_DIVERGENTE'
          );
        }
        validatedPrices.push({
          plan_key: plan.key,
          price_id: price.id,
          currency: price.currency,
          interval: price.recurring.interval,
          amount_cents: price.unit_amount
        });
      }
      return {
        account_id: account.id,
        mode,
        public_base_url: publicBaseUrl,
        prices: validatedPrices
      };
    } catch (error) {
      throw asProviderError(error, 'Não foi possível validar a configuração no Stripe.');
    }
  }

  function adminConfiguration() {
    const configuration = effectiveConfiguration();
    const missing = missingConfiguration(configuration, {
      webhook: true,
      requireEnabled: false
    });
    return {
      provider: PROVIDER,
      enabled: configuration.enabled,
      mode: configuration.mode,
      source: configuration.source,
      public_base_url: configuration.publicBaseUrl,
      has_secret_key: Boolean(configuration.secretKey),
      has_webhook_secret: Boolean(configuration.webhookSecret),
      configured: missing.length === 0,
      missing,
      webhook_path: '/api/payments/webhooks/stripe',
      prices: paidPlans().map((plan) => ({
        plan_key: plan.key,
        plan_name: plan.name,
        amount_cents: plan.price_cents,
        price_label: plan.price_label,
        external_price_id: configuration.prices[plan.key] || null
      }))
    };
  }

  async function testConfiguration(input = {}) {
    const current = effectiveConfiguration();
    const configuration = {
      mode: input.mode || current.mode,
      secretKey: input.secret_key || current.secretKey,
      webhookSecret: input.webhook_secret || current.webhookSecret,
      publicBaseUrl: input.public_base_url || current.publicBaseUrl,
      prices: input.prices || current.prices
    };
    return validateStripeConfiguration(configuration);
  }

  async function configureProvider(actorUserId, input = {}) {
    const current = effectiveConfiguration();
    const requestedMode = input.mode || current.mode;
    const protectedBindings = db.get(
      `SELECT
         SUM(CASE WHEN status IN ('active', 'past_due', 'canceling', 'trialing', 'incomplete')
                   OR access_granted = 1 THEN 1 ELSE 0 END) AS subscriptions,
         (SELECT COUNT(*) FROM checkout_sessions
           WHERE provider = ? AND mode = ? AND status IN ('creating', 'open')) AS checkouts
       FROM subscriptions
      WHERE provider = ? AND mode = ?`,
      [PROVIDER, current.mode, PROVIDER, current.mode]
    );
    const hasProtectedBindings =
      Number(protectedBindings?.subscriptions || 0) > 0 ||
      Number(protectedBindings?.checkouts || 0) > 0;

    if (requestedMode !== current.mode && hasProtectedBindings) {
      throw conflict(
        'Encerre ou reconcilie as assinaturas e checkouts do ambiente atual antes de trocar o modo Stripe.',
        'MODO_STRIPE_EM_USO'
      );
    }
    if (input.enabled === false && input.remove_secrets === true) {
      if (hasProtectedBindings) {
        throw conflict(
          'As credenciais não podem ser removidas enquanto houver assinaturas ou checkouts ativos.',
          'CREDENCIAIS_STRIPE_EM_USO'
        );
      }
      db.transaction((tx) => {
        tx.run(
          `INSERT INTO payment_providers
             (provider, enabled, mode, encrypted_secret_key, encrypted_webhook_secret,
              public_base_url, updated_by, updated_at)
           VALUES (?, 0, ?, NULL, NULL, ?, ?, datetime('now'))
           ON CONFLICT (provider) DO UPDATE SET
             enabled = 0, mode = excluded.mode, encrypted_secret_key = NULL,
             encrypted_webhook_secret = NULL, public_base_url = excluded.public_base_url,
             updated_by = excluded.updated_by, updated_at = datetime('now')`,
          [PROVIDER, requestedMode, input.public_base_url || null, actorUserId]
        );
        tx.run('DELETE FROM payment_plan_prices WHERE provider = ?', [PROVIDER]);
        tx.run('DELETE FROM payment_customers WHERE provider = ?', [PROVIDER]);
      });
      return adminConfiguration();
    }

    const configuration = {
      mode: requestedMode,
      secretKey: input.secret_key || current.secretKey,
      webhookSecret: input.webhook_secret || current.webhookSecret,
      publicBaseUrl: input.public_base_url || current.publicBaseUrl,
      prices: input.prices || current.prices
    };
    if (input.enabled !== false) await validateStripeConfiguration(configuration);
    const encryptedSecret = configuration.secretKey
      ? encryptString(configuration.secretKey, { aad: SECRET_AAD, key: encryptionKey })
      : null;
    const encryptedWebhook = configuration.webhookSecret
      ? encryptString(configuration.webhookSecret, { aad: WEBHOOK_AAD, key: encryptionKey })
      : null;
    const publicBaseUrl = configuration.publicBaseUrl
      ? validatedBaseUrl(configuration.publicBaseUrl)
      : null;
    db.transaction((tx) => {
      if (requestedMode !== current.mode) {
        tx.run('DELETE FROM payment_customers WHERE provider = ? AND mode = ?', [
          PROVIDER,
          current.mode
        ]);
      }
      tx.run(
        `INSERT INTO payment_providers
           (provider, enabled, mode, encrypted_secret_key, encrypted_webhook_secret,
            public_base_url, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (provider) DO UPDATE SET
           enabled = excluded.enabled,
           mode = excluded.mode,
           encrypted_secret_key = excluded.encrypted_secret_key,
           encrypted_webhook_secret = excluded.encrypted_webhook_secret,
           public_base_url = excluded.public_base_url,
           updated_by = excluded.updated_by,
           updated_at = datetime('now')`,
        [
          PROVIDER,
          input.enabled === false ? 0 : 1,
          configuration.mode,
          encryptedSecret,
          encryptedWebhook,
          publicBaseUrl,
          actorUserId
        ]
      );
      tx.run('DELETE FROM payment_plan_prices WHERE provider = ? AND mode = ?', [
        PROVIDER,
        configuration.mode
      ]);
      for (const [planKey, priceId] of Object.entries(configuration.prices || {})) {
        if (!priceId) continue;
        tx.run(
          `INSERT INTO payment_plan_prices
             (plan_key, provider, mode, external_price_id, currency, recurring_interval, active)
           VALUES (?, ?, ?, ?, 'brl', 'month', 1)`,
          [planKey, PROVIDER, configuration.mode, priceId]
        );
      }
    });
    return adminConfiguration();
  }

  function metrics() {
    const mode = effectiveConfiguration().mode;
    return {
      subscriptions: db.all(
        `SELECT status, COUNT(*) AS total
           FROM subscriptions
          WHERE provider = ? AND mode = ?
          GROUP BY status ORDER BY total DESC`,
        [PROVIDER, mode]
      ),
      revenue: db.get(
        `SELECT COALESCE(SUM(amount_paid_cents), 0) AS amount_paid_cents,
                COUNT(*) AS invoices
           FROM invoices_or_receipts
          WHERE provider = ? AND mode = ? AND status = 'paid'`,
        [PROVIDER, mode]
      ),
      webhooks: db.get(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN processing_status = 'failed' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN processing_status = 'processed' THEN 1 ELSE 0 END) AS processed
           FROM webhook_events WHERE provider = ? AND mode = ?`,
        [PROVIDER, mode]
      ),
      duplicate_active_users: db.all(
        `SELECT user_id, COUNT(*) AS total
           FROM subscriptions
          WHERE provider = ? AND mode = ?
            AND access_granted = 1 AND status IN ('active', 'past_due')
          GROUP BY user_id HAVING COUNT(*) > 1`,
        [PROVIDER, mode]
      )
    };
  }

  async function reconcileAll() {
    const mode = effectiveConfiguration().mode;
    const users = db.all(
      `SELECT DISTINCT user_id FROM subscriptions
        WHERE provider = ? AND mode = ? AND external_subscription_id IS NOT NULL`,
      [PROVIDER, mode]
    );
    const results = [];
    for (const user of users) results.push(await reconcileUser(user.user_id));
    return { users: results.length, results };
  }

  async function cancelForAccountDeletion(userId) {
    const configuration = effectiveConfiguration();
    const subscriptions = db.all(
      `SELECT external_subscription_id
         FROM subscriptions
        WHERE user_id = ? AND provider = ? AND mode = ?
          AND external_subscription_id IS NOT NULL
          AND status NOT IN ('canceled', 'expired', 'incomplete_expired')`,
      [userId, PROVIDER, configuration.mode]
    );
    if (subscriptions.length === 0) return { canceled: 0 };
    const { stripe } = stripeContext({ requireEnabled: false });
    let canceled = 0;
    for (const subscription of subscriptions) {
      try {
        const remote = await stripe.subscriptions.cancel(subscription.external_subscription_id);
        syncSubscription(remote, Math.floor(now().getTime() / 1000), { grantAccess: false });
        canceled += 1;
      } catch (error) {
        throw asProviderError(
          error,
          'A exclusão da conta foi interrompida porque o Stripe não confirmou o encerramento da cobrança. Tente novamente.'
        );
      }
    }
    return { canceled };
  }

  return Object.freeze({
    adminConfiguration,
    cancel,
    cancelForAccountDeletion,
    configureProvider,
    createCheckout,
    createPortal,
    getSubscription,
    handleStripeWebhook,
    listInvoices,
    listPlans,
    metrics,
    reconcileAll,
    reconcileUser,
    testConfiguration
  });
}

export { ensurePaymentsSchema } from './payments.schema.js';
