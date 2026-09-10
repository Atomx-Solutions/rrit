-- S1-A01 API endpoints use optimistic concurrency while retaining the
-- organization/brand data model introduced by 0025.
ALTER TABLE organizations
  ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0);

CREATE OR REPLACE FUNCTION organization_require_designated_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM organization_memberships
    WHERE organization_id = NEW.id
      AND user_id = NEW.created_by
      AND role = 'owner'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Organization % requires an active owner membership.', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION organization_preserve_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_organization_id uuid := COALESCE(NEW.organization_id, OLD.organization_id);
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE id = affected_organization_id) AND NOT EXISTS (
    SELECT 1
    FROM organizations AS organization
    JOIN organization_memberships AS membership
      ON membership.organization_id = organization.id
      AND membership.user_id = organization.created_by
      AND membership.role = 'owner'
      AND membership.status = 'active'
    WHERE organization.id = affected_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization % requires an active owner membership.', affected_organization_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER organizations_require_designated_owner
AFTER INSERT OR UPDATE OF created_by ON organizations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION organization_require_designated_owner();

CREATE CONSTRAINT TRIGGER organization_memberships_preserve_owner
AFTER DELETE OR UPDATE OF organization_id, user_id, role, status ON organization_memberships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION organization_preserve_owner_membership();
