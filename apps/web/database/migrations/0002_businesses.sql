CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE RESTRICT,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  state jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE posts (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payload->>'status' IN ('draft', 'review', 'approved', 'scheduled', 'published', 'failed')),
  CHECK (payload->>'channel' IN ('Instagram', 'Facebook')),
  CHECK (length(payload->>'caption') <= 2200)
);
CREATE INDEX posts_business_created ON posts (business_id, created_at DESC, id);
CREATE INDEX posts_business_status ON posts (business_id, (payload->>'status'));
CREATE TABLE assets (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]',
  rights boolean NOT NULL DEFAULT false,
  mime text NOT NULL CHECK (mime = 'image/jpeg'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 2097152),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_business_created ON assets (business_id, created_at DESC, id);
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  action text NOT NULL,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_business_created ON audit_events (business_id, created_at DESC);
CREATE TABLE plan_catalog (
  name text PRIMARY KEY,
  monthly_cents integer NOT NULL CHECK (monthly_cents > 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  annual_discount_percent integer NOT NULL CHECK (annual_discount_percent BETWEEN 0 AND 100),
  description text NOT NULL,
  features jsonb NOT NULL,
  sort_order integer NOT NULL,
  purchasable boolean NOT NULL DEFAULT false
);
-- Proposed catalog, configurable in the database. Checkout is intentionally unavailable.
INSERT INTO plan_catalog VALUES
('Fillimi', 1900, 'EUR', 20, 'Për të qenë i pranishëm, pa e komplikuar.', '["1 biznes", "Facebook & Instagram", "12 drafte postimesh në muaj", "Fotografitë e tua", "Kalendari i postimeve"]', 1, false),
('Përditë', 3900, 'EUR', 20, 'Për biznesin që ka diçka për të ndarë çdo javë.', '["1 biznes", "Facebook & Instagram", "30 drafte postimesh në muaj", "Variante të tekstit me AI", "Miratim dhe planifikim"]', 2, false),
('Më shumë', 7900, 'EUR', 20, 'Më shumë hapësirë për idetë dhe postimet e tua.', '["1 biznes", "Facebook & Instagram", "60 drafte postimesh në muaj", "Variante të tekstit me AI", "Ndihmë me përparësi"]', 3, false);
