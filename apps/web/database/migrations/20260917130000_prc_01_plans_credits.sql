-- PRC-01: canonical commercial configuration, subscriptions, credits and
-- brand-scoped Meta style history.  The existing plan_catalog and
-- entitlements remain readable during the staged migration of application
-- workflows; plans below are the source of truth for new billing work.

CREATE TABLE plans (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  name text NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 2 AND 120),
  monthly_cents integer NOT NULL CHECK (monthly_cents >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  posts_per_month integer NOT NULL CHECK (posts_per_month >= 0),
  monthly_credits integer NOT NULL CHECK (monthly_credits >= 0),
  style_fetch_post_count integer NOT NULL CHECK (style_fetch_post_count BETWEEN 1 AND 100),
  is_trial boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL UNIQUE CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((is_trial AND monthly_cents = 0) OR (NOT is_trial AND monthly_cents > 0))
);

INSERT INTO plans
  (code, name, monthly_cents, posts_per_month, monthly_credits, style_fetch_post_count, is_trial, sort_order)
VALUES
  ('free-trial', 'Free Trial', 0, 3, 250, 10, true, 0),
  ('pako-1', 'Pako 1', 2499, 14, 1000, 10, false, 1),
  ('pako-2', 'Pako 2', 4499, 30, 2250, 20, false, 2),
  ('pako-3', 'Pako 3', 7999, 60, 4000, 30, false, 3);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES plans(code) ON DELETE RESTRICT,
  billing_interval text NOT NULL CHECK (billing_interval IN ('monthly', 'annual')),
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  provider_subscription_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end > current_period_start)
);
CREATE INDEX subscriptions_organization_period ON subscriptions (organization_id, current_period_end DESC);
CREATE UNIQUE INDEX subscriptions_one_current_per_organization
  ON subscriptions (organization_id)
  WHERE status IN ('trialing', 'active', 'past_due');

-- There is one common credit pool per organization. Reserved credits are a
-- claim against that same pool for planned posts, not a second wallet.
CREATE TABLE credit_balances (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- Reserved credits remain part of the one common balance. The amount a
  -- non-reserved operation may spend is remaining_credits - reserved_credits.
  remaining_credits integer NOT NULL DEFAULT 0 CHECK (remaining_credits >= 0),
  reserved_credits integer NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  period_start timestamptz,
  period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((period_start IS NULL AND period_end IS NULL) OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end > period_start))
);

CREATE TABLE credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('grant', 'reserve', 'release', 'consume', 'refund', 'expire', 'adjustment')),
  usage_kind text CHECK (usage_kind IN ('research', 'generation')),
  -- Reservations only change the claim against a common balance, so they
  -- intentionally have a zero balance delta.
  credit_delta integer NOT NULL,
  reference_type text,
  reference_id text,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (event_type IN ('reserve', 'release') AND credit_delta = 0)
    OR (event_type NOT IN ('reserve', 'release') AND credit_delta <> 0)
  ),
  CHECK ((event_type IN ('consume', 'reserve', 'release') AND usage_kind IS NOT NULL) OR event_type NOT IN ('consume', 'reserve', 'release'))
);
CREATE INDEX credit_ledger_organization_created ON credit_ledger (organization_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX credit_ledger_idempotency
  ON credit_ledger (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Commercial token price, kept independently from provider cost telemetry.
-- One token/credit is sold for EUR 0.02; changing this row never requires a
-- deployment or a rewrite of package records.
CREATE TABLE credit_pricing (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  token_price_cents integer NOT NULL CHECK (token_price_cents > 0),
  provider_token_cost_micro_eur integer NOT NULL CHECK (provider_token_cost_micro_eur > 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO credit_pricing (singleton, token_price_cents, provider_token_cost_micro_eur)
VALUES (true, 2, 7000);

-- Meta connections and imported posts previously belonged to the legacy
-- business/organization root. Give them a canonical brand owner before style
-- snapshots are introduced. Existing organizations have a seeded first brand.
ALTER TABLE meta_connections ADD COLUMN brand_id uuid;
UPDATE meta_connections connection
SET brand_id = (
  SELECT id
  FROM brands
  WHERE organization_id = connection.business_id
  ORDER BY created_at, id
  LIMIT 1
)
WHERE connection.brand_id IS NULL;
ALTER TABLE meta_connections
  ADD CONSTRAINT meta_connections_brand_organization_fkey
  FOREIGN KEY (brand_id, business_id) REFERENCES brands(id, organization_id) ON DELETE RESTRICT;
CREATE INDEX meta_connections_brand ON meta_connections (brand_id) WHERE brand_id IS NOT NULL;

ALTER TABLE social_posts ADD COLUMN brand_id uuid;
UPDATE social_posts post
SET brand_id = connection.brand_id
FROM meta_connections connection
WHERE post.brand_id IS NULL
  AND connection.business_id = post.business_id
  AND post.source_account_id IN (connection.page_id, connection.instagram_id);
ALTER TABLE social_posts
  ADD CONSTRAINT social_posts_brand_organization_fkey
  FOREIGN KEY (brand_id, business_id) REFERENCES brands(id, organization_id) ON DELETE RESTRICT;
CREATE INDEX social_posts_brand_published ON social_posts (brand_id, published_at DESC, id DESC)
  WHERE brand_id IS NOT NULL;

CREATE TABLE style_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  source_connection_id uuid REFERENCES meta_connections(id) ON DELETE SET NULL,
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  source_post_count integer NOT NULL CHECK (source_post_count >= 0),
  source_revision text NOT NULL,
  last_style_fetch_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id),
  FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX style_snapshots_organization_fetched ON style_snapshots (organization_id, last_style_fetch_at DESC);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE style_snapshots ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON plans TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON subscriptions, credit_balances TO app_runtime;
GRANT SELECT, INSERT ON credit_ledger TO app_runtime;
GRANT SELECT ON credit_pricing TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON style_snapshots TO app_runtime;

CREATE POLICY plans_runtime_read ON plans FOR SELECT TO app_runtime USING (true);
CREATE POLICY subscriptions_runtime_tenant ON subscriptions FOR ALL TO app_runtime
  USING (organization_id = app.current_organization_id())
  WITH CHECK (organization_id = app.current_organization_id());
CREATE POLICY credit_balances_runtime_tenant ON credit_balances FOR ALL TO app_runtime
  USING (organization_id = app.current_organization_id())
  WITH CHECK (organization_id = app.current_organization_id());
CREATE POLICY credit_ledger_runtime_read ON credit_ledger FOR SELECT TO app_runtime
  USING (organization_id = app.current_organization_id());
CREATE POLICY credit_ledger_runtime_insert ON credit_ledger FOR INSERT TO app_runtime
  WITH CHECK (organization_id = app.current_organization_id());
CREATE POLICY credit_pricing_runtime_read ON credit_pricing FOR SELECT TO app_runtime USING (true);
CREATE POLICY style_snapshots_runtime_tenant ON style_snapshots FOR ALL TO app_runtime
  USING (organization_id = app.current_organization_id())
  WITH CHECK (organization_id = app.current_organization_id());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  GRANT SELECT ON plans, subscriptions, credit_balances, credit_ledger, credit_pricing, style_snapshots TO rrit_worker;
  GRANT INSERT, UPDATE ON credit_balances, style_snapshots TO rrit_worker;
  GRANT INSERT ON credit_ledger TO rrit_worker;

  CREATE POLICY plans_worker_read ON plans FOR SELECT TO rrit_worker USING (true);
  CREATE POLICY subscriptions_worker_read ON subscriptions FOR SELECT TO rrit_worker USING (true);
  CREATE POLICY credit_balances_worker_read ON credit_balances FOR SELECT TO rrit_worker USING (true);
  CREATE POLICY credit_balances_worker_write ON credit_balances FOR ALL TO rrit_worker USING (true) WITH CHECK (true);
  CREATE POLICY credit_ledger_worker_read ON credit_ledger FOR SELECT TO rrit_worker USING (true);
  CREATE POLICY credit_ledger_worker_insert ON credit_ledger FOR INSERT TO rrit_worker WITH CHECK (true);
  CREATE POLICY credit_pricing_worker_read ON credit_pricing FOR SELECT TO rrit_worker USING (true);
  CREATE POLICY style_snapshots_worker_read ON style_snapshots FOR SELECT TO rrit_worker USING (true);
  CREATE POLICY style_snapshots_worker_write ON style_snapshots FOR ALL TO rrit_worker USING (true) WITH CHECK (true);
END
$$;
