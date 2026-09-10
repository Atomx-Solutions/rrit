CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'marketer', 'approver', 'analyst', 'billing')),
  brand_scope text NOT NULL DEFAULT 'ALL_BRANDS' CHECK (brand_scope IN ('ALL_BRANDS', 'RESTRICTED')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile) = 'object'),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  timezone text NOT NULL DEFAULT 'Europe/Belgrade' CHECK (length(trim(timezone)) BETWEEN 1 AND 100),
  locale text NOT NULL DEFAULT 'sq-XK' CHECK (length(trim(locale)) BETWEEN 2 AND 35),
  category text NOT NULL CHECK (length(trim(category)) BETWEEN 2 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug),
  UNIQUE (id, organization_id),
  CHECK ((status = 'active' AND archived_at IS NULL) OR (status = 'archived' AND archived_at IS NOT NULL))
);

CREATE TABLE brand_access (
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, brand_id, user_id),
  FOREIGN KEY (brand_id, organization_id)
    REFERENCES brands(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX organization_memberships_user ON organization_memberships (user_id, organization_id);
CREATE INDEX brands_organization_status ON brands (organization_id, status, created_at DESC);
CREATE INDEX brand_access_user ON brand_access (organization_id, user_id, brand_id);

INSERT INTO organizations (id, slug, name, created_by)
SELECT
  b.id,
  CASE
    WHEN b.slug_count = 1 THEN b.slug
    ELSE left(b.slug, 47) || '-' || replace(b.id::text, '-', '')
  END,
  COALESCE(NULLIF(trim(b.state #>> '{brand,name}'), ''), b.slug),
  b.owner_id
FROM (
  SELECT b.*, count(*) OVER (PARTITION BY b.slug) AS slug_count
  FROM businesses b
) b
ON CONFLICT (id) DO NOTHING;

INSERT INTO organization_memberships (organization_id, user_id, role, brand_scope)
SELECT id, created_by, 'owner', 'ALL_BRANDS'
FROM organizations
ON CONFLICT (organization_id, user_id) DO NOTHING;

INSERT INTO brands (
  id,
  organization_id,
  slug,
  name,
  profile,
  settings,
  timezone,
  locale,
  category
)
SELECT
  gen_random_uuid(),
  b.id,
  b.slug,
  COALESCE(NULLIF(trim(b.state #>> '{brand,name}'), ''), b.slug),
  COALESCE(b.state->'brand', '{}'::jsonb),
  '{}'::jsonb,
  COALESCE(NULLIF(trim(b.state #>> '{preferences,timezone}'), ''), 'Europe/Belgrade'),
  'sq-XK',
  COALESCE(NULLIF(trim(b.state #>> '{brand,industry}'), ''), 'general')
FROM businesses b
WHERE NOT EXISTS (SELECT 1 FROM brands existing WHERE existing.organization_id = b.id);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_access ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON organizations TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_memberships TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON brands TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON brand_access TO app_runtime;

CREATE POLICY organizations_tenant_access ON organizations
  FOR ALL TO app_runtime
  USING (
    (app.current_organization_id() IS NULL OR id = app.current_organization_id())
    AND EXISTS (
      SELECT 1
      FROM organization_memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = app.current_user_id()
        AND m.status = 'active'
    )
  )
  WITH CHECK (
    created_by = app.current_user_id()
    AND (app.current_organization_id() IS NULL OR id = app.current_organization_id())
  );

CREATE POLICY organization_memberships_tenant_access ON organization_memberships
  FOR ALL TO app_runtime
  USING (
    user_id = app.current_user_id()
    AND (app.current_organization_id() IS NULL OR organization_id = app.current_organization_id())
  )
  WITH CHECK (
    user_id = app.current_user_id()
    AND organization_id = app.current_organization_id()
  );

CREATE POLICY brands_tenant_access ON brands
  FOR ALL TO app_runtime
  USING (
    organization_id = app.current_organization_id()
    AND EXISTS (
      SELECT 1
      FROM organization_memberships m
      WHERE m.organization_id = brands.organization_id
        AND m.user_id = app.current_user_id()
        AND m.status = 'active'
        AND (
          m.brand_scope = 'ALL_BRANDS'
          OR EXISTS (
            SELECT 1
            FROM brand_access ba
            WHERE ba.organization_id = brands.organization_id
              AND ba.brand_id = brands.id
              AND ba.user_id = app.current_user_id()
          )
        )
    )
  )
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND EXISTS (
      SELECT 1
      FROM organization_memberships m
      WHERE m.organization_id = brands.organization_id
        AND m.user_id = app.current_user_id()
        AND m.status = 'active'
        AND (
          m.brand_scope = 'ALL_BRANDS'
          OR EXISTS (
            SELECT 1
            FROM brand_access ba
            WHERE ba.organization_id = brands.organization_id
              AND ba.brand_id = brands.id
              AND ba.user_id = app.current_user_id()
          )
        )
    )
  );

CREATE POLICY brand_access_tenant_access ON brand_access
  FOR ALL TO app_runtime
  USING (
    organization_id = app.current_organization_id()
    AND (
      user_id = app.current_user_id()
      OR EXISTS (
        SELECT 1
        FROM organization_memberships m
        WHERE m.organization_id = brand_access.organization_id
          AND m.user_id = app.current_user_id()
          AND m.status = 'active'
          AND m.role IN ('owner', 'admin')
      )
    )
  )
  WITH CHECK (
    organization_id = app.current_organization_id()
    AND (
      user_id = app.current_user_id()
      OR EXISTS (
        SELECT 1
        FROM organization_memberships m
        WHERE m.organization_id = brand_access.organization_id
          AND m.user_id = app.current_user_id()
          AND m.status = 'active'
          AND m.role IN ('owner', 'admin')
      )
    )
  );
