-- S1-A08: turn the legacy workspace audit log into a tenant-scoped,
-- append-only audit ledger. This is deliberately a forward-only migration:
-- existing events are retained and normalised rather than recreated.

ALTER TABLE audit_events
  ADD COLUMN organization_id uuid,
  ADD COLUMN resource_type text,
  ADD COLUMN resource_id text,
  ADD COLUMN result text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE audit_events
SET
  organization_id = business_id,
  resource_type = split_part(action, '.', 1),
  resource_id = business_id::text,
  result = 'succeeded',
  metadata = '{}'::jsonb
WHERE organization_id IS NULL;

ALTER TABLE audit_events
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN resource_type SET NOT NULL,
  ALTER COLUMN resource_id SET NOT NULL,
  ALTER COLUMN result SET NOT NULL,
  ALTER COLUMN revision SET DEFAULT 0,
  ADD CONSTRAINT audit_events_resource_type_check
    CHECK (resource_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  ADD CONSTRAINT audit_events_resource_id_check
    CHECK (length(trim(resource_id)) BETWEEN 1 AND 200),
  ADD CONSTRAINT audit_events_action_check
    CHECK (action ~ '^[a-z][a-z0-9_]{0,63}(\.[a-z][a-z0-9_]{0,63})+$'),
  ADD CONSTRAINT audit_events_result_check
    CHECK (result IN ('succeeded', 'failed', 'denied', 'cancelled')),
  ADD CONSTRAINT audit_events_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object');

-- Historical audit rows must not disappear with a workspace/business.
DO $$
DECLARE
  legacy_fk text;
BEGIN
  SELECT conname
  INTO legacy_fk
  FROM pg_constraint
  WHERE conrelid = 'audit_events'::regclass
    AND contype = 'f'
    AND confrelid = 'businesses'::regclass
    AND confdeltype = 'c';

  IF legacy_fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE audit_events DROP CONSTRAINT %I', legacy_fk);
  END IF;
END
$$;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT,
  ADD CONSTRAINT audit_events_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE INDEX audit_events_organization_created
  ON audit_events (organization_id, created_at DESC, id DESC);
CREATE INDEX audit_events_resource_created
  ON audit_events (organization_id, resource_type, resource_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION app.audit_metadata_is_safe(input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  unsafe_key boolean;
  unsafe_value boolean;
BEGIN
  IF jsonb_typeof(input) <> 'object' OR octet_length(input::text) > 4096 THEN
    RETURN false;
  END IF;

  WITH RECURSIVE nodes(value, depth) AS (
    SELECT input, 0
    UNION ALL
    SELECT child.value, nodes.depth + 1
    FROM nodes
    CROSS JOIN LATERAL (
      SELECT value FROM jsonb_each(
        CASE WHEN jsonb_typeof(nodes.value) = 'object' THEN nodes.value ELSE '{}'::jsonb END
      )
      UNION ALL
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(nodes.value) = 'array' THEN nodes.value ELSE '[]'::jsonb END
      )
    ) child
    WHERE nodes.depth < 8
  )
  SELECT EXISTS (
    SELECT 1
    FROM nodes
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(nodes.value) = 'object' THEN nodes.value ELSE '{}'::jsonb END
    ) entry
    WHERE true
      AND entry.key ~* '(token|secret|password|api.?key|credential|authorization|cookie|ciphertext|private.?key)'
  )
  INTO unsafe_key;

  WITH RECURSIVE nodes(value, depth) AS (
    SELECT input, 0
    UNION ALL
    SELECT child.value, nodes.depth + 1
    FROM nodes
    CROSS JOIN LATERAL (
      SELECT value FROM jsonb_each(
        CASE WHEN jsonb_typeof(nodes.value) = 'object' THEN nodes.value ELSE '{}'::jsonb END
      )
      UNION ALL
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(nodes.value) = 'array' THEN nodes.value ELSE '[]'::jsonb END
      )
    ) child
    WHERE nodes.depth < 8
  )
  SELECT EXISTS (
    SELECT 1
    FROM nodes
    WHERE jsonb_typeof(value) = 'string'
      AND trim(both '"' FROM value::text) ~* '(^bearer[[:space:]]|^eyJ[A-Za-z0-9_-]{10,})'
  )
  INTO unsafe_value;

  RETURN NOT unsafe_key AND NOT unsafe_value;
END
$$;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_metadata_safe_check
    CHECK (app.audit_metadata_is_safe(metadata));

CREATE OR REPLACE FUNCTION app.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only'
    USING ERRCODE = '55000';
END
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_event_mutation();

-- Resolve the tenant table at migration time. This keeps the function usable
-- in the isolated schemas created by the integration and RLS test harnesses.
DO $$
DECLARE
  tenant_schema text := current_schema();
BEGIN
  EXECUTE format($function$
    CREATE OR REPLACE FUNCTION app.record_audit_event(
      p_actor_id uuid,
      p_organization_id uuid,
      p_business_id uuid,
      p_resource_type text,
      p_resource_id text,
      p_action text,
      p_result text DEFAULT 'succeeded',
      p_metadata jsonb DEFAULT '{}'::jsonb,
      p_revision integer DEFAULT 0
    )
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, app
    AS $body$
    DECLARE
      event_id bigint;
      actor_is_member boolean;
    BEGIN
      IF app.current_user_id() IS DISTINCT FROM p_actor_id
        OR app.current_organization_id() IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'audit actor or organization does not match tenant context'
          USING ERRCODE = '42501';
      END IF;

      IF p_business_id IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'audit business must be the organization workspace'
          USING ERRCODE = '23514';
      END IF;

      EXECUTE 'SELECT EXISTS (
        SELECT 1 FROM %1$I.organization_memberships
        WHERE organization_id = $1 AND user_id = $2 AND status = ''active''
      )'
      INTO actor_is_member
      USING p_organization_id, p_actor_id;

      IF NOT actor_is_member THEN
        RAISE EXCEPTION 'audit actor is not an active organization member'
          USING ERRCODE = '42501';
      END IF;

      IF p_resource_type !~ '^[a-z][a-z0-9_]{0,63}$'
        OR length(trim(p_resource_id)) NOT BETWEEN 1 AND 200
        OR p_action !~ '^[a-z][a-z0-9_]{0,63}(\.[a-z][a-z0-9_]{0,63})+$'
        OR p_result NOT IN ('succeeded', 'failed', 'denied', 'cancelled')
        OR NOT app.audit_metadata_is_safe(p_metadata) THEN
        RAISE EXCEPTION 'invalid audit event payload'
          USING ERRCODE = '23514';
      END IF;

      EXECUTE 'INSERT INTO %1$I.audit_events
        (business_id, actor_id, action, revision, organization_id, resource_type, resource_id, result, metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id'
      INTO event_id
      USING p_business_id, p_actor_id, p_action, p_revision, p_organization_id,
        p_resource_type, p_resource_id, p_result, p_metadata;

      RETURN event_id;
    END
    $body$
  $function$, tenant_schema);
END
$$;

REVOKE ALL ON FUNCTION app.audit_metadata_is_safe(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reject_audit_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_audit_event(uuid, uuid, uuid, text, text, text, text, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_audit_event(uuid, uuid, uuid, text, text, text, text, jsonb, integer) TO app_runtime;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    REVOKE INSERT, UPDATE, DELETE ON audit_events FROM rrit_worker;
    GRANT EXECUTE ON FUNCTION app.record_audit_event(uuid, uuid, uuid, text, text, text, text, jsonb, integer) TO rrit_worker;
  END IF;
END
$$;

REVOKE INSERT, UPDATE, DELETE ON audit_events FROM app_runtime;
GRANT SELECT ON audit_events TO app_runtime;

DROP POLICY IF EXISTS audit_events_tenant_access ON audit_events;
DROP POLICY IF EXISTS audit_events_read_own ON audit_events;
CREATE POLICY audit_events_read_own ON audit_events
  FOR SELECT TO app_runtime
  USING (
    organization_id = app.current_organization_id()
    AND EXISTS (
      SELECT 1
      FROM organization_memberships membership
      WHERE membership.organization_id = audit_events.organization_id
        AND membership.user_id = app.current_user_id()
        AND membership.status = 'active'
    )
  );
