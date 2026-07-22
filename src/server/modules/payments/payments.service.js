// ============================================================================
// Kairo — Pagamentos e aplicação real dos planos (Tarefa 13)
// ----------------------------------------------------------------------------
// Fluxo real e auditável de assinatura: cria uma cobrança (checkout) para um
// plano pago, recebe a confirmação do provedor por WEBHOOK ASSINADO (HMAC-SHA256,
// idempotente por event_id) e, na confirmação, APLICA o plano ao usuário de
// verdade (muda users.plan). O provedor externo (Stripe/Mercado Pago) pluga-se
// aqui enviando webhooks assinados com o mesmo segredo. Sem simulação: a lógica
// de negócio, a idempotência e a verificação de integridade são reais; apenas as
// credenciais do gateway vêm de configuração (ambiente).
// ============================================================================

import crypto from 'node:crypto';
import { badRequest, notFound, unprocessable } from '../../shared/http-error.js';

const PROVIDERS_SUPORTADOS = new Set(['stripe', 'mercadopago', 'manual']);

export function ensurePaymentsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'canceled', 'expired')),
      provider TEXT NOT NULL,
      external_ref TEXT,
      amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
      current_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id, status);');
  // Idempotência dos webhooks: cada event_id do provedor é processado uma vez.
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      type TEXT NOT NULL,
      subscription_id INTEGER,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (provider, event_id)
    );
  `);
}

export function createPaymentsService({
  db,
  plansService,
  webhookSecret = null,
  periodDays = 30,
  now = () => new Date()
} = {}) {
  if (!db || !plansService) {
    throw new Error('O serviço de pagamentos exige banco de dados e o serviço de planos.');
  }
  ensurePaymentsSchema(db);

  function agoraIso() {
    return now().toISOString().slice(0, 19).replace('T', ' ');
  }

  function fimDoPeriodo() {
    const d = now();
    d.setUTCDate(d.getUTCDate() + periodDays);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  // Planos pagos disponíveis (exclui o Free, que não requer cobrança).
  function listPlans() {
    const { plans } = plansService.getMatrix();
    return plans.map((p) => ({
      key: p.key,
      name: p.name,
      price_cents: p.price,
      price_label: p.price > 0 ? `R$${(p.price / 100).toFixed(2).replace('.', ',')}` : 'Grátis',
      description: p.description,
      payable: p.price > 0
    }));
  }

  function planoValidoPago(planKey) {
    const plano = listPlans().find((p) => p.key === planKey);
    if (!plano) throw notFound('Plano não encontrado.', 'PLANO_NAO_ENCONTRADO');
    if (!plano.payable) {
      throw unprocessable('O plano Free não exige pagamento.', 'PLANO_GRATUITO');
    }
    return plano;
  }

  // Aplica o plano ao usuário de verdade (muda users.plan). Núcleo da Tarefa 13.
  function applyPlanToUser(userId, planKey) {
    const info = db.run("UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?", [
      planKey,
      userId
    ]);
    if (info.changes === 0) {
      throw notFound('Usuário não encontrado.', 'USUARIO_NAO_ENCONTRADO');
    }
    return { user_id: userId, plan: planKey };
  }

  // Cria uma cobrança pendente para um plano pago e retorna os dados de checkout.
  function createCheckout(userId, input = {}) {
    const provider = String(input.provider || 'manual');
    if (!PROVIDERS_SUPORTADOS.has(provider)) {
      throw badRequest('Provedor de pagamento não suportado.', 'PROVEDOR_INVALIDO');
    }
    const plano = planoValidoPago(input.plan_key);
    const externalRef = `kairo_${provider}_${crypto.randomUUID()}`;

    const resultado = db.run(
      `INSERT INTO subscriptions (user_id, plan_key, status, provider, external_ref, amount_cents)
       VALUES (?, ?, 'pending', ?, ?, ?)`,
      [userId, plano.key, provider, externalRef, plano.price_cents]
    );

    return {
      checkout_id: resultado.lastInsertRowid,
      external_ref: externalRef,
      provider,
      plan_key: plano.key,
      amount_cents: plano.price_cents,
      price_label: plano.price_label,
      status: 'pending'
    };
  }

  // Assinatura HMAC-SHA256 canônica sobre os campos essenciais do evento.
  function assinar(payload) {
    if (!webhookSecret) return null;
    const base = `${payload.event_id}.${payload.type}.${payload.external_ref}.${payload.status}`;
    return crypto.createHmac('sha256', webhookSecret).update(base).digest('hex');
  }

  function assinaturaValida(payload, signature) {
    if (!webhookSecret) return true; // sem segredo configurado, não há verificação
    const esperado = assinar(payload);
    if (!esperado || !signature) return false;
    const a = Buffer.from(esperado, 'hex');
    const b = Buffer.from(String(signature), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // Processa um webhook do provedor: valida assinatura, garante idempotência e,
  // na confirmação de pagamento, aplica o plano. Reversível no cancelamento.
  function handleWebhook(provider, payload = {}, signature = null) {
    if (!PROVIDERS_SUPORTADOS.has(String(provider))) {
      throw badRequest('Provedor de pagamento não suportado.', 'PROVEDOR_INVALIDO');
    }
    const { event_id: eventId, type, external_ref: externalRef, status } = payload;
    if (!eventId || !type || !externalRef) {
      throw badRequest('Evento de pagamento incompleto.', 'EVENTO_INVALIDO');
    }
    if (!assinaturaValida(payload, signature)) {
      throw unprocessable('Assinatura do webhook inválida.', 'ASSINATURA_INVALIDA');
    }

    // Idempotência: se o evento já foi processado, não repete o efeito.
    const jaProcessado = db.get(
      'SELECT id FROM payment_events WHERE provider = ? AND event_id = ?',
      [provider, eventId]
    );
    if (jaProcessado) {
      return { processed: false, reason: 'evento já processado', event_id: eventId };
    }

    const assinatura = db.get(
      'SELECT * FROM subscriptions WHERE provider = ? AND external_ref = ?',
      [provider, externalRef]
    );
    if (!assinatura) {
      throw notFound('Assinatura não encontrada para o evento.', 'ASSINATURA_NAO_ENCONTRADA');
    }

    let efeito = 'ignorado';
    // db.transaction(fn) executa imediatamente e retorna o resultado.
    db.transaction(() => {
      db.run(
        'INSERT INTO payment_events (provider, event_id, type, subscription_id, detail) VALUES (?, ?, ?, ?, ?)',
        [provider, eventId, type, assinatura.id, `${type}:${status || ''}`]
      );

      if (type === 'payment.succeeded' || status === 'paid' || status === 'active') {
        db.run(
          `UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = datetime('now')
           WHERE id = ?`,
          [fimDoPeriodo(), assinatura.id]
        );
        applyPlanToUser(assinatura.user_id, assinatura.plan_key);
        efeito = 'plano_aplicado';
      } else if (type === 'subscription.canceled' || status === 'canceled') {
        db.run(
          `UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE id = ?`,
          [assinatura.id]
        );
        applyPlanToUser(assinatura.user_id, 'free');
        efeito = 'plano_revertido_free';
      }
    });

    return {
      processed: true,
      event_id: eventId,
      subscription_id: assinatura.id,
      effect: efeito,
      applied_at: agoraIso()
    };
  }

  function getActiveSubscription(userId) {
    return (
      db.get(
        `SELECT id, plan_key, status, provider, amount_cents, current_period_end, updated_at
           FROM subscriptions
          WHERE user_id = ? AND status = 'active'
          ORDER BY id DESC LIMIT 1`,
        [userId]
      ) || null
    );
  }

  // Cancelamento pelo próprio usuário: encerra a assinatura ativa e volta ao Free.
  function cancel(userId) {
    const ativa = getActiveSubscription(userId);
    if (!ativa) {
      throw unprocessable('Nenhuma assinatura ativa para cancelar.', 'SEM_ASSINATURA_ATIVA');
    }
    db.transaction(() => {
      db.run(
        `UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE id = ?`,
        [ativa.id]
      );
      applyPlanToUser(userId, 'free');
    });
    return { canceled: true, previous_plan: ativa.plan_key, plan: 'free' };
  }

  return {
    listPlans,
    createCheckout,
    handleWebhook,
    getActiveSubscription,
    cancel,
    applyPlanToUser,
    // Exposto para o provedor/testes assinarem eventos com o mesmo segredo.
    signEvent: assinar
  };
}
