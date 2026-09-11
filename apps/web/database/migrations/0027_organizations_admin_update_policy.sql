-- Organization creation is authorized by the creator. Once it exists, only
-- its active owner or admin may write it under the tenant-scoped runtime role.
DROP POLICY organizations_tenant_access ON organizations;

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
