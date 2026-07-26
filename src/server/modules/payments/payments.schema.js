// ============================================================================
// Kairo — Persistência financeira mínima e idempotente (Tarefa 13)
// ============================================================================

const SUBSCRIPTION_STATUSES = Object.freeze([
  'checkout_pending',
  'checkout_failed',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'paused',
  'canceling',
  'canceled',
  'expired'
]);

function tableExists(db, tableName) {
  return Boolean(
    db.get("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName])
  );
}

function tableColumns(db, tableName) {
  if (!tableExists(db, tableName)) return new Set();
  return new Set(db.pragma(`table_info(${tableName})`).map((column) => column.name));
}

function createSubscriptionsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'checkout_pending'
        CHECK (status IN (${SUBSCRIPTION_STATUSES.map((status) => `'${status}'`).join(', ')})),
      provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
      mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
      external_ref TEXT NOT NULL,
      checkout_session_id TEXT,
      external_subscription_id TEXT,
      external_customer_id TEXT,
      external_price_id TEXT,
      amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
      currency TEXT NOT NULL DEFAULT 'brl',
      current_period_start TEXT,
      current_period_end TEXT,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
      access_granted INTEGER NOT NULL DEFAULT 0 CHECK (access_granted IN (0, 1)),
      access_granted_at TEXT,
      last_provider_event_created INTEGER NOT NULL DEFAULT 0,
      latest_invoice_id TEXT,
      checkout_url TEXT,
      checkout_url_expires_at TEXT,
      failure_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (plan_key) REFERENCES plans (key)
    );
  `);
}

function migrateLegacySubscriptions(db) {
  const columns = tableColumns(db, 'subscriptions');
  if (columns.size === 0) {
    createSubscriptionsTable(db);
    return;
  }
  if (columns.has('checkout_session_id') && columns.has('access_granted')) return;

  db.transaction((tx) => {
    tx.exec('ALTER TABLE subscriptions RENAME TO subscriptions_legacy_v13;');
    createSubscriptionsTable(tx);
    tx.exec(`
      INSERT INTO subscriptions
        (id, user_id, plan_key, status, provider, external_ref, amount_cents,
         current_period_end, access_granted, failure_code, created_at, updated_at)
      SELECT id,
             user_id,
             plan_key,
             'expired',
             'stripe',
             COALESCE(NULLIF(external_ref, ''), 'legado-' || id),
             amount_cents,
             current_period_end,
             0,
             'legacy_unverified',
             created_at,
             updated_at
        FROM subscriptions_legacy_v13;
      DROP TABLE subscriptions_legacy_v13;
    `);
  });
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  if (!tableColumns(db, tableName).has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
}

export function ensurePaymentsSchema(db) {
  migrateLegacySubscriptions(db);
  addColumnIfMissing(db, 'subscriptions', 'checkout_url', 'TEXT');
  addColumnIfMissing(db, 'subscriptions', 'access_granted_at', 'TEXT');
  addColumnIfMissing(db, 'subscriptions', 'mode', "TEXT NOT NULL DEFAULT 'test'");
  db.run(
    `UPDATE subscriptions
        SET status = 'expired', access_granted = 0, access_granted_at = NULL,
            failure_code = COALESCE(failure_code, 'legacy_unverified'),
            updated_at = datetime('now')
      WHERE provider = 'stripe'
        AND external_subscription_id IS NULL
        AND checkout_session_id IS NULL
        AND access_granted = 1`
  );

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_external_ref
      ON subscriptions (external_ref);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_checkout_session
      ON subscriptions (checkout_session_id)
      WHERE checkout_session_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_subscription
      ON subscriptions (provider, external_subscription_id)
      WHERE external_subscription_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
      ON subscriptions (user_id, access_granted, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_mode_status
      ON subscriptions (user_id, mode, access_granted, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS payment_providers (
      provider TEXT PRIMARY KEY CHECK (provider = 'stripe'),
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
      encrypted_secret_key TEXT,
      encrypted_webhook_secret TEXT,
      public_base_url TEXT,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS payment_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
      mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
      external_customer_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      UNIQUE (user_id, provider),
      UNIQUE (provider, external_customer_id)
    );

    CREATE TABLE IF NOT EXISTS payment_plan_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_key TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
      mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
      external_price_id TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'brl',
      recurring_interval TEXT NOT NULL DEFAULT 'month',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plan_key) REFERENCES plans (key) ON DELETE CASCADE,
      UNIQUE (plan_key, provider, mode),
      UNIQUE (provider, mode, external_price_id)
    );
    CREATE INDEX IF NOT EXISTS idx_payment_plan_prices_active
      ON payment_plan_prices (provider, mode, active, plan_key);

    CREATE TABLE IF NOT EXISTS checkout_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      plan_key TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
      mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
      external_session_id TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'creating'
        CHECK (status IN ('creating', 'open', 'complete', 'expired', 'failed')),
      checkout_url TEXT,
      expires_at TEXT,
      failure_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (plan_key) REFERENCES plans (key),
      UNIQUE (provider, external_session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user
      ON checkout_sessions (user_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
      mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      processing_status TEXT NOT NULL DEFAULT 'processing'
        CHECK (processing_status IN ('processing', 'processed', 'failed')),
      payload_sha256 TEXT NOT NULL,
      provider_created_at INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
      error_code TEXT,
      error_message TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (provider, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_events_status
      ON webhook_events (processing_status, received_at DESC);

    CREATE TABLE IF NOT EXISTS invoices_or_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subscription_id INTEGER,
      provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
      mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
      external_invoice_id TEXT NOT NULL,
      external_customer_id TEXT,
      status TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount_due_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_due_cents >= 0),
      amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
      hosted_invoice_url TEXT,
      invoice_pdf_url TEXT,
      period_start TEXT,
      period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE SET NULL,
      UNIQUE (provider, external_invoice_id)
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_user
      ON invoices_or_receipts (user_id, created_at DESC);
  `);

  addColumnIfMissing(db, 'payment_customers', 'mode', "TEXT NOT NULL DEFAULT 'test'");
  addColumnIfMissing(db, 'checkout_sessions', 'mode', "TEXT NOT NULL DEFAULT 'test'");
  addColumnIfMissing(db, 'webhook_events', 'mode', "TEXT NOT NULL DEFAULT 'test'");
  addColumnIfMissing(db, 'invoices_or_receipts', 'mode', "TEXT NOT NULL DEFAULT 'test'");
  db.exec(`
    UPDATE checkout_sessions
       SET status = 'expired', failure_code = COALESCE(failure_code, 'superseded_checkout')
     WHERE status IN ('creating', 'open')
       AND id NOT IN (
         SELECT id FROM (
           SELECT id,
                  ROW_NUMBER() OVER (PARTITION BY user_id, mode ORDER BY created_at DESC, id DESC) AS position
             FROM checkout_sessions
            WHERE status IN ('creating', 'open')
         ) WHERE position = 1
       );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_sessions_single_open_user_mode
      ON checkout_sessions (user_id, mode)
      WHERE status IN ('creating', 'open');
  `);

  // A versão anterior já possuía payment_events. As colunas abaixo preservam
  // o histórico existente e completam o vínculo mínimo sem copiar payload bruto.
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
  addColumnIfMissing(db, 'payment_events', 'user_id', 'INTEGER');
  addColumnIfMissing(db, 'payment_events', 'external_object_id', 'TEXT');
  addColumnIfMissing(db, 'payment_events', 'amount_cents', 'INTEGER');
  addColumnIfMissing(db, 'payment_events', 'currency', 'TEXT');
  addColumnIfMissing(db, 'payment_events', 'mode', "TEXT NOT NULL DEFAULT 'test'");
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_payment_events_user ON payment_events (user_id, created_at DESC);'
  );
}

export { SUBSCRIPTION_STATUSES };
