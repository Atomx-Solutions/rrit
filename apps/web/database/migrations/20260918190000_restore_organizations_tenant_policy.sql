-- Restores the single organizations tenant policy of 0027 after two
-- uncommitted migrations (20260918170000_organization_onboarding_rls,
-- 20260918180000_organizations_command_rls) replaced it with per-command
-- policies on a shared database. Onboarding is fixed in the application
-- instead: a new organization is created with a plain INSERT, because
-- INSERT ... ON CONFLICT also applies the membership-based SELECT policy.
DROP POLICY IF EXISTS organizations_onboarding_insert ON organizations;
DROP POLICY IF EXISTS organizations_tenant_select ON organizations;
DROP POLICY IF EXISTS organizations_tenant_insert ON organizations;
DROP POLICY IF EXISTS organizations_tenant_update ON organizations;
DROP POLICY IF EXISTS organizations_tenant_delete ON organizations;
DROP POLICY IF EXISTS organizations_tenant_access ON organizations;

CREATE POLICY organizations_tenant_access ON organizations
  FOR ALL TO app_runtime
  USING (
    (app.current_organization_id() IS NULL OR id = app.current_organization_id())
    AND EXISTS (
      SELECT 1
      FROM organization_memberships AS membership
      WHERE membership.organization_id = organizations.id
        AND membership.user_id = app.current_user_id()
        AND membership.status = 'active'
    )
  )
  WITH CHECK (
    (
      created_by = app.current_user_id()
      AND (app.current_organization_id() IS NULL OR id = app.current_organization_id())
    )
    OR (
      id = app.current_organization_id()
      AND EXISTS (
        SELECT 1
        FROM organization_memberships AS membership
        WHERE membership.organization_id = organizations.id
          AND membership.user_id = app.current_user_id()
          AND membership.status = 'active'
          AND membership.role IN ('owner', 'admin')
      )
    )
  );
