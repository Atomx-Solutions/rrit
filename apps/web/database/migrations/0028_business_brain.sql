-- S1-A06/S1-B06: tenant-scoped, versioned Business Brain knowledge.
CREATE TABLE brand_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('explicit', 'candidate')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'verified', 'rejected', 'archived')),
  text text NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 1000),
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 500),
  source_url text,
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'website', 'social', 'import', 'ai')),
  confidence numeric(4,3) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE,
  CHECK (source_url IS NULL OR source_url ~* '^https?://'),
  CHECK (kind = 'candidate' OR source_type <> 'ai'),
  CHECK (status <> 'verified' OR verified_at IS NOT NULL)
);

CREATE TABLE brand_voice_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  text text NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 1000),
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 500),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE,
  UNIQUE (brand_id, version)
);

CREATE TABLE brand_audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE
);

CREATE TABLE brand_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  currency text NOT NULL CHECK (currency IN ('EUR', 'ALL')),
  amount numeric(12,2) CHECK (amount IS NULL OR amount >= 0),
  valid_from date NOT NULL,
  valid_until date,
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 500),
  confidence numeric(4,3) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE,
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE brand_guardrails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  text text NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 1000),
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX brand_facts_scope ON brand_facts (organization_id, brand_id, status, updated_at DESC);
CREATE INDEX brand_voice_active ON brand_voice_versions (organization_id, brand_id, active, version DESC);
CREATE INDEX brand_audiences_scope ON brand_audiences (organization_id, brand_id, status);
CREATE INDEX brand_offers_scope ON brand_offers (organization_id, brand_id, status, valid_from DESC);
CREATE INDEX brand_guardrails_scope ON brand_guardrails (organization_id, brand_id, status);

-- Preserve the facts and voice already collected by the legacy brand editor.
INSERT INTO brand_facts (organization_id, brand_id, kind, status, text, source, source_type, confidence, verified_at)
SELECT b.organization_id,
       b.id,
       'explicit',
       CASE WHEN COALESCE(f.value->>'verified', 'false') = 'true' THEN 'verified' ELSE 'proposed' END,
       trim(f.value->>'text'),
       COALESCE(NULLIF(trim(f.value->>'source'), ''), 'Migrim nga profili i biznesit'),
       'manual',
       1,
       CASE WHEN COALESCE(f.value->>'verified', 'false') = 'true' THEN now() ELSE NULL END
FROM brands b
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(b.profile->'facts') = 'array' THEN b.profile->'facts' ELSE '[]'::jsonb END
) AS f(value)
WHERE length(trim(f.value->>'text')) BETWEEN 1 AND 1000;

INSERT INTO brand_voice_versions (organization_id, brand_id, version, text, source, active)
SELECT organization_id, id, 1, trim(profile->>'voice'), 'Migrim nga profili i biznesit', true
FROM brands
WHERE length(trim(COALESCE(profile->>'voice', ''))) BETWEEN 1 AND 1000;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['brand_facts', 'brand_voice_versions', 'brand_audiences', 'brand_offers', 'brand_guardrails'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_runtime', table_name);
    EXECUTE format($policy$
      CREATE POLICY %I ON %I FOR ALL TO app_runtime
      USING (
        organization_id = app.current_organization_id()
        AND EXISTS (
          SELECT 1 FROM organization_memberships m
          WHERE m.organization_id = %I.organization_id
            AND m.user_id = app.current_user_id()
            AND m.status = 'active'
            AND (m.brand_scope = 'ALL_BRANDS' OR EXISTS (
              SELECT 1 FROM brand_access ba
              WHERE ba.organization_id = %I.organization_id
                AND ba.brand_id = %I.brand_id
                AND ba.user_id = app.current_user_id()
            ))
        )
      )
      WITH CHECK (
        organization_id = app.current_organization_id()
        AND EXISTS (
          SELECT 1 FROM organization_memberships m
          WHERE m.organization_id = %I.organization_id
            AND m.user_id = app.current_user_id()
            AND m.status = 'active'
            AND (m.brand_scope = 'ALL_BRANDS' OR EXISTS (
              SELECT 1 FROM brand_access ba
              WHERE ba.organization_id = %I.organization_id
                AND ba.brand_id = %I.brand_id
                AND ba.user_id = app.current_user_id()
            ))
        )
      )
    $policy$, table_name || '_tenant_access', table_name, table_name, table_name, table_name, table_name, table_name, table_name);
  END LOOP;
END
$$;
