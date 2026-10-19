CREATE TABLE paddle_payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES custom_packages(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('parent_package', 'add_on')),
  posts_included integer NOT NULL CHECK (posts_included >= 0),
  videos_included integer NOT NULL CHECK (videos_included >= 0),
  credits_included integer NOT NULL CHECK (credits_included >= 0),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency = 'EUR'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'canceled')),
  paddle_transaction_id text UNIQUE,
  paddle_customer_id text,
  paddle_event_id text UNIQUE,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX paddle_payment_orders_org_created
  ON paddle_payment_orders(organization_id, created_at DESC);

ALTER TABLE paddle_payment_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON paddle_payment_orders FROM PUBLIC;
