-- An invitation is opened before the organization has a client, so its audit
-- row carries no tenant at all. It joins the existing platform-scope exemption
-- rather than inventing a tenant that does not exist yet. Widening the list
-- only admits a resource type that was previously rejected; every row already
-- stored still satisfies the constraint.
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_scope_check;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_scope_check CHECK (
    (organization_id IS NOT NULL AND business_id IS NOT NULL)
    OR (organization_id IS NULL AND business_id IS NULL
        AND resource_type IN (
          'plan',
          'credit_pricing',
          'invoice_settings',
          'platform_settings',
          'package_request',
          'custom_package',
          'organization_invitation'
        ))
  );
