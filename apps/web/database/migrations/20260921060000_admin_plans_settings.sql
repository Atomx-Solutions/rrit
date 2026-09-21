-- RRIT-SA-10: superadmin reads and edits packages, credit pricing and invoice
-- settings. Changing a package price never touches existing subscriptions:
-- they keep the price_cents fixed when they were bought.

-- Platform-wide changes belong to no organization. They are recorded in the
-- same audit ledger with a NULL tenant; tenant RLS policies filter on the
-- organization, so customers never see them. Tenant events still require both.
ALTER TABLE audit_events
  ALTER COLUMN business_id DROP NOT NULL,
  ALTER COLUMN organization_id DROP NOT NULL,
  ADD CONSTRAINT audit_events_scope_check CHECK (
    (organization_id IS NOT NULL AND business_id IS NOT NULL)
    OR (organization_id IS NULL AND business_id IS NULL
        AND resource_type IN ('plan', 'credit_pricing', 'invoice_settings'))
  );

CREATE OR REPLACE FUNCTION public.admin_plans_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'plans', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(plan) ORDER BY plan.sort_order)
      FROM public.plans AS plan
    ), '[]'::jsonb),
    'credit_pricing', (SELECT pg_catalog.to_jsonb(pricing) - 'singleton' FROM public.credit_pricing AS pricing),
    'invoice_settings', (SELECT pg_catalog.to_jsonb(settings) - 'singleton' FROM public.invoice_settings AS settings)
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_record_platform_change(
  p_actor_id uuid,
  p_actor_email text,
  p_resource_type text,
  p_resource_id text,
  p_before jsonb,
  p_after jsonb,
  p_changes jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    NULL, NULL, p_actor_id, 'admin_' || p_resource_type || '_change.update', p_resource_type, p_resource_id, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_' || p_resource_type || '_change',
      'actor_email', p_actor_email,
      'changes', p_changes,
      'before', p_before,
      'after', p_after
    ),
    0
  );
$function$;

-- Business-rule failures raise P0001 with a stable code as message.
CREATE OR REPLACE FUNCTION public.admin_update_plan(
  p_code text,
  p_actor_id uuid,
  p_actor_email text,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.plans%ROWTYPE;
  after_row public.plans%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.plans WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.plans SET
      name = COALESCE(p_changes->>'name', name),
      monthly_cents = COALESCE((p_changes->>'monthly_cents')::integer, monthly_cents),
      posts_per_month = COALESCE((p_changes->>'posts_per_month')::integer, posts_per_month),
      monthly_credits = COALESCE((p_changes->>'monthly_credits')::integer, monthly_credits),
      style_fetch_post_count = COALESCE((p_changes->>'style_fetch_post_count')::integer, style_fetch_post_count),
      active = COALESCE((p_changes->>'active')::boolean, active),
      sort_order = COALESCE((p_changes->>'sort_order')::integer, sort_order),
      updated_at = pg_catalog.now()
    WHERE code = p_code
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'PLAN_CONFLICT' USING ERRCODE = 'P0001';
    WHEN check_violation THEN
      RAISE EXCEPTION 'PLAN_INVALID' USING ERRCODE = 'P0001';
  END;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'plan', p_code, pg_catalog.to_jsonb(before_row), pg_catalog.to_jsonb(after_row), p_changes
  );
  RETURN pg_catalog.to_jsonb(after_row);
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_credit_pricing(
  p_actor_id uuid,
  p_actor_email text,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.credit_pricing%ROWTYPE;
  after_row public.credit_pricing%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.credit_pricing WHERE singleton FOR UPDATE;
  BEGIN
    UPDATE public.credit_pricing SET
      credit_price_cents = COALESCE((p_changes->>'credit_price_cents')::integer, credit_price_cents),
      provider_cost_per_credit_micro_eur = COALESCE((p_changes->>'provider_cost_per_credit_micro_eur')::integer, provider_cost_per_credit_micro_eur),
      low_credit_threshold = COALESCE((p_changes->>'low_credit_threshold')::integer, low_credit_threshold),
      updated_at = pg_catalog.now()
    WHERE singleton
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE = 'P0001';
  END;
  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'credit_pricing', 'credit_pricing',
    pg_catalog.to_jsonb(before_row) - 'singleton', pg_catalog.to_jsonb(after_row) - 'singleton', p_changes
  );
  RETURN pg_catalog.to_jsonb(after_row) - 'singleton';
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_invoice_settings(
  p_actor_id uuid,
  p_actor_email text,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.invoice_settings%ROWTYPE;
  after_row public.invoice_settings%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.invoice_settings WHERE singleton FOR UPDATE;
  BEGIN
    UPDATE public.invoice_settings SET
      number_prefix = COALESCE(p_changes->>'number_prefix', number_prefix),
      seller_name = COALESCE(p_changes->>'seller_name', seller_name),
      seller_address = COALESCE(p_changes->>'seller_address', seller_address),
      seller_fiscal_number = COALESCE(p_changes->>'seller_fiscal_number', seller_fiscal_number),
      vat_rate_basis_points = COALESCE((p_changes->>'vat_rate_basis_points')::integer, vat_rate_basis_points),
      updated_at = pg_catalog.now()
    WHERE singleton
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE = 'P0001';
  END;
  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'invoice_settings', 'invoice_settings',
    pg_catalog.to_jsonb(before_row) - 'singleton', pg_catalog.to_jsonb(after_row) - 'singleton', p_changes
  );
  RETURN pg_catalog.to_jsonb(after_row) - 'singleton';
END
$function$;

REVOKE ALL ON FUNCTION public.admin_plans_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_platform_change(uuid, text, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_plan(text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_credit_pricing(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_invoice_settings(uuid, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_plans_settings() TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_update_plan(text, uuid, text, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_update_credit_pricing(uuid, text, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_update_invoice_settings(uuid, text, jsonb) TO service_role;
  END IF;
END
$$;
