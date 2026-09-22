-- RRIT-SA-19: expose annual package discounts and active subscription counts
-- to the superadmin pricing editor. The discount already belongs to each plan;
-- this migration only makes that existing setting editable through the admin RPC.

CREATE OR REPLACE FUNCTION public.admin_plans_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'plans', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(plan) || pg_catalog.jsonb_build_object(
          'active_subscriptions', (
            SELECT pg_catalog.count(*)
            FROM public.subscriptions AS subscription
            WHERE subscription.plan_code = plan.code
              AND subscription.status = 'active'
          )
        )
        ORDER BY plan.sort_order
      )
      FROM public.plans AS plan
    ), '[]'::jsonb),
    'credit_pricing', (SELECT pg_catalog.to_jsonb(pricing) - 'singleton' FROM public.credit_pricing AS pricing),
    'invoice_settings', (SELECT pg_catalog.to_jsonb(settings) - 'singleton' FROM public.invoice_settings AS settings)
  );
$function$;

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
      annual_discount_percent = CASE
        WHEN is_trial THEN 0
        ELSE COALESCE((p_changes->>'annual_discount_percent')::integer, annual_discount_percent)
      END,
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

REVOKE ALL ON FUNCTION public.admin_plans_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_plan(text, uuid, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_plans_settings() TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_update_plan(text, uuid, text, jsonb) TO service_role;
  END IF;
END
$$;
