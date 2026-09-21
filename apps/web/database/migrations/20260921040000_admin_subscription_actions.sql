-- RRIT-SA-08: superadmin subscription management (pause, resume, change
-- plan, extend, cancel). The change and its audit event are written in the
-- same transaction, so an action is never applied without being recorded.
--
-- The acted-on subscription is the organization's current one: trialing,
-- active or past_due, plus paused (which the one-current index does not
-- cover). Business-rule failures raise P0001 with a stable code as message.
CREATE OR REPLACE FUNCTION public.admin_change_subscription(
  p_organization_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_action text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_row public.subscriptions%ROWTYPE;
  updated_row public.subscriptions%ROWTYPE;
  next_plan public.plans%ROWTYPE;
  next_interval text;
  extend_days integer;
  reason text;
BEGIN
  SELECT subscription.* INTO current_row
  FROM public.subscriptions AS subscription
  WHERE subscription.organization_id = p_organization_id
    AND subscription.status IN ('trialing', 'active', 'past_due', 'paused')
  ORDER BY subscription.created_at DESC, subscription.id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_ACTIVE_SUBSCRIPTION' USING ERRCODE = 'P0001';
  END IF;

  IF p_action = 'pause' THEN
    IF current_row.status = 'paused' THEN
      RAISE EXCEPTION 'SUBSCRIPTION_ALREADY_PAUSED' USING ERRCODE = 'P0001';
    END IF;
    reason := NULLIF(pg_catalog.btrim(p_params->>'reason'), '');
    UPDATE public.subscriptions
    SET status = 'paused', paused_at = pg_catalog.now(), paused_by = p_actor_email,
        paused_reason = reason, updated_at = pg_catalog.now()
    WHERE id = current_row.id
    RETURNING * INTO updated_row;

  ELSIF p_action = 'resume' THEN
    IF current_row.status <> 'paused' THEN
      RAISE EXCEPTION 'SUBSCRIPTION_NOT_PAUSED' USING ERRCODE = 'P0001';
    END IF;
    -- A paused row is outside the one-current index; another current
    -- subscription may have started meanwhile.
    IF EXISTS (
      SELECT 1 FROM public.subscriptions AS other
      WHERE other.organization_id = p_organization_id
        AND other.id <> current_row.id
        AND other.status IN ('trialing', 'active', 'past_due')
    ) THEN
      RAISE EXCEPTION 'OTHER_SUBSCRIPTION_ACTIVE' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.subscriptions
    SET status = 'active', paused_at = NULL, paused_by = NULL, paused_reason = NULL,
        updated_at = pg_catalog.now()
    WHERE id = current_row.id
    RETURNING * INTO updated_row;

  ELSIF p_action = 'change_plan' THEN
    next_interval := p_params->>'billing_interval';
    SELECT plan.* INTO next_plan
    FROM public.plans AS plan
    WHERE plan.code = p_params->>'plan_code' AND plan.active AND NOT plan.is_trial;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PLAN_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;
    -- Same price rule as the application: annual = monthly x 12 minus the
    -- plan's annual discount, rounded to the cent.
    UPDATE public.subscriptions
    SET plan_code = next_plan.code,
        billing_interval = next_interval,
        price_cents = CASE WHEN next_interval = 'annual'
          THEN pg_catalog.round(next_plan.monthly_cents * 12 * (100 - next_plan.annual_discount_percent) / 100.0)::integer
          ELSE next_plan.monthly_cents END,
        pending_plan_code = NULL,
        updated_at = pg_catalog.now()
    WHERE id = current_row.id
    RETURNING * INTO updated_row;

  ELSIF p_action = 'extend' THEN
    extend_days := (p_params->>'days')::integer;
    IF extend_days IS NULL OR extend_days NOT BETWEEN 1 AND 365 THEN
      RAISE EXCEPTION 'INVALID_EXTENSION' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.subscriptions
    SET current_period_end = current_period_end + pg_catalog.make_interval(days => extend_days),
        updated_at = pg_catalog.now()
    WHERE id = current_row.id
    RETURNING * INTO updated_row;

  ELSIF p_action = 'cancel' THEN
    UPDATE public.subscriptions
    SET status = 'cancelled', cancel_at_period_end = true, updated_at = pg_catalog.now()
    WHERE id = current_row.id
    RETURNING * INTO updated_row;

  ELSE
    RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    p_organization_id,
    p_organization_id,
    p_actor_id,
    'admin_subscription_change.' || p_action,
    'subscription',
    updated_row.id::text,
    'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_subscription_change',
      'action', p_action,
      'organization_id', p_organization_id,
      'actor_email', p_actor_email,
      'params', p_params,
      'before', pg_catalog.jsonb_build_object(
        'status', current_row.status, 'plan_code', current_row.plan_code,
        'billing_interval', current_row.billing_interval, 'price_cents', current_row.price_cents,
        'current_period_end', current_row.current_period_end
      ),
      'after', pg_catalog.jsonb_build_object(
        'status', updated_row.status, 'plan_code', updated_row.plan_code,
        'billing_interval', updated_row.billing_interval, 'price_cents', updated_row.price_cents,
        'current_period_end', updated_row.current_period_end
      )
    ),
    0
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', updated_row.id,
    'organization_id', updated_row.organization_id,
    'plan_code', updated_row.plan_code,
    'billing_interval', updated_row.billing_interval,
    'status', updated_row.status,
    'current_period_start', updated_row.current_period_start,
    'current_period_end', updated_row.current_period_end,
    'price_cents', updated_row.price_cents,
    'cancel_at_period_end', updated_row.cancel_at_period_end,
    'pending_plan_code', updated_row.pending_plan_code,
    'paused_at', updated_row.paused_at,
    'paused_by', updated_row.paused_by,
    'paused_reason', updated_row.paused_reason,
    'updated_at', updated_row.updated_at
  );
END
$function$;

REVOKE ALL ON FUNCTION public.admin_change_subscription(uuid, uuid, text, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_change_subscription(uuid, uuid, text, text, jsonb) TO service_role;
  END IF;
END
$$;
