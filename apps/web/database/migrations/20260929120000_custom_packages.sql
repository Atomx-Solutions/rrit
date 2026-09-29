-- Custom packages: a commercial agreement the superadmin negotiates with one
-- organization, outside the shared plan catalogue. A plan is a product offered
-- to everyone; a custom package exists for exactly one organization, carries its
-- own post allowance and its own agreed price, and runs for a fixed period.
--
-- The suggested price is derived from a configurable per-post rate rather than
-- from a constant in application code, because the rate is a commercial setting
-- the superadmin changes without a deployment. The agreed price is stored
-- separately, so overriding the suggestion never loses what was suggested.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS custom_package_post_price_cents integer NOT NULL DEFAULT 150;
ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_custom_package_post_price_cents_check;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_custom_package_post_price_cents_check
  CHECK (custom_package_post_price_cents > 0);

CREATE TABLE custom_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  posts_included integer NOT NULL CHECK (posts_included > 0 AND posts_included <= 1000),
  -- The price the superadmin agreed. It may match the suggestion or override it.
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  -- What the per-post rate suggested when this package was written, kept so a
  -- later rate change never rewrites the history of an agreed package.
  suggested_price_cents integer NOT NULL CHECK (suggested_price_cents >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'expired', 'cancelled')),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX custom_packages_organization_period
  ON custom_packages (organization_id, ends_at DESC, id DESC);
-- An organization runs at most one package at a time; drafts and closed
-- packages may coexist with it.
CREATE UNIQUE INDEX custom_packages_one_active_per_organization
  ON custom_packages (organization_id)
  WHERE status = 'active';

ALTER TABLE custom_packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE custom_packages FROM PUBLIC;

-- The tenant may read its own package; only the superadmin path writes one.
GRANT SELECT ON custom_packages TO app_runtime;
CREATE POLICY custom_packages_runtime_tenant ON custom_packages FOR SELECT TO app_runtime
  USING (organization_id = app.current_organization_id());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  GRANT SELECT ON custom_packages TO rrit_worker;
  CREATE POLICY custom_packages_worker_read ON custom_packages FOR SELECT TO rrit_worker USING (true);
END
$$;

-- Platform-wide audit events carry no tenant. A custom package always belongs to
-- one organization, so its audit rows stay tenant-scoped and need no exemption.
