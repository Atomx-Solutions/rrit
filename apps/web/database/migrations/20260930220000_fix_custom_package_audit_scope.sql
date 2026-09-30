-- Organizations created through the lead flow do not necessarily have a
-- legacy businesses row. Custom-package audits are superadmin records, so
-- keep them platform-scoped instead of inventing a business_id.
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_scope_check;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_scope_check CHECK (
    (organization_id IS NOT NULL AND business_id IS NOT NULL)
    OR (organization_id IS NULL AND business_id IS NULL
        AND resource_type IN ('plan', 'credit_pricing', 'invoice_settings', 'platform_settings', 'package_request', 'custom_package'))
  );

CREATE OR REPLACE FUNCTION public.admin_create_custom_package(
  p_organization_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_package jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  created_row public.custom_packages%ROWTYPE;
  posts_included integer := (p_package->>'posts_included')::integer;
  rate integer;
  suggested integer;
  invoice_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  rate := COALESCE((p_package->>'post_price_cents')::integer, public.admin_custom_package_post_rate());
  suggested := posts_included * rate;
  BEGIN
    INSERT INTO public.custom_packages
      (organization_id, name, posts_included, post_price_cents, price_cents, suggested_price_cents, starts_at, ends_at, status, notes)
    VALUES (p_organization_id, p_package->>'name', posts_included, rate,
      COALESCE((p_package->>'price_cents')::integer, suggested), suggested,
      (p_package->>'starts_at')::timestamptz, (p_package->>'ends_at')::timestamptz,
      p_package->>'status', p_package->>'notes')
    RETURNING * INTO created_row;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE = 'P0001';
    WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
      RAISE EXCEPTION 'PACKAGE_INVALID' USING ERRCODE = 'P0001';
  END;
  invoice_id := public.admin_issue_custom_package_invoice(created_row.id);
  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    NULL, NULL, p_actor_id, 'admin_custom_package.create', 'custom_package', created_row.id::text, 'succeeded',
    pg_catalog.jsonb_build_object('event_type', 'admin_custom_package_change', 'actor_email', p_actor_email,
      'changes', p_package, 'after', pg_catalog.to_jsonb(created_row), 'invoice_id', invoice_id), 0
  );
  RETURN pg_catalog.to_jsonb(created_row) || pg_catalog.jsonb_build_object('invoice_id', invoice_id);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_create_custom_package(uuid, uuid, text, jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_create_custom_package(uuid, uuid, text, jsonb) TO service_role;
  END IF;
END $$;
