-- The overview lists every organization created this week, not only five.
CREATE OR REPLACE FUNCTION public.admin_overview_kpis()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH month_start AS (
    SELECT pg_catalog.date_trunc('month', pg_catalog.now()) AS value
  ),
  week_start AS (
    SELECT pg_catalog.date_trunc('week', pg_catalog.now()) AS value
  ),
  organization_states AS (
    SELECT
      organization.id,
      latest_subscription.status
    FROM public.organizations AS organization
    LEFT JOIN LATERAL (
      SELECT subscription.status
      FROM public.subscriptions AS subscription
      WHERE subscription.organization_id = organization.id
      ORDER BY subscription.created_at DESC, subscription.id DESC
      LIMIT 1
    ) AS latest_subscription ON true
  )
  SELECT pg_catalog.jsonb_build_object(
    'organizations', pg_catalog.jsonb_build_object(
      'total', (SELECT pg_catalog.count(*) FROM public.organizations),
      'active', (SELECT pg_catalog.count(*) FROM organization_states WHERE status = 'active'),
      'trialing', (SELECT pg_catalog.count(*) FROM organization_states WHERE status = 'trialing'),
      'paused', (SELECT pg_catalog.count(*) FROM organization_states WHERE status = 'paused'),
      'cancelled', (SELECT pg_catalog.count(*) FROM organization_states WHERE status = 'cancelled')
    ),
    'subscriptions', pg_catalog.jsonb_build_object(
      'mrr_cents', (
        SELECT COALESCE(pg_catalog.sum(subscription.price_cents), 0)::bigint
        FROM public.subscriptions AS subscription
        WHERE subscription.status = 'active'
          AND (
            subscription.billing_interval = 'monthly'
            OR subscription.current_period_start >= (SELECT value FROM month_start)
          )
      ),
      'active', (SELECT pg_catalog.count(*) FROM public.subscriptions WHERE status = 'active'),
      'trialing', (SELECT pg_catalog.count(*) FROM public.subscriptions WHERE status = 'trialing')
    ),
    'revenue', pg_catalog.jsonb_build_object(
      'total_cents', (
        SELECT COALESCE(pg_catalog.sum(invoice.total_cents), 0::bigint)
        FROM public.invoices AS invoice
        WHERE invoice.kind = 'invoice'
      ),
      'this_month_cents', (
        SELECT COALESCE(pg_catalog.sum(invoice.total_cents), 0::bigint)
        FROM public.invoices AS invoice
        WHERE invoice.kind = 'invoice'
          AND invoice.issued_at >= (SELECT value FROM month_start)
      )
    ),
    'ai', pg_catalog.jsonb_build_object(
      'cost_micro_eur_this_month', (
        SELECT COALESCE(pg_catalog.sum(cost.actual_cost_micro_eur), 0::bigint)
        FROM public.ai_cost_ledger AS cost
        WHERE cost.settled_at >= (SELECT value FROM month_start)
      ),
      'cost_micro_eur_total', (
        SELECT COALESCE(pg_catalog.sum(cost.actual_cost_micro_eur), 0::bigint)
        FROM public.ai_cost_ledger AS cost
        WHERE cost.settled_at IS NOT NULL
      )
    ),
    'users', pg_catalog.jsonb_build_object(
      'total', (SELECT pg_catalog.count(*) FROM auth.users)
    ),
    'signups', pg_catalog.jsonb_build_object(
      'this_week', (
        SELECT pg_catalog.count(*)
        FROM public.organizations AS organization
        WHERE organization.created_at >= (SELECT value FROM week_start)
      ),
      'this_month', (
        SELECT pg_catalog.count(*)
        FROM public.organizations AS organization
        WHERE organization.created_at >= (SELECT value FROM month_start)
      )
    ),
    'new_organizations', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', recent.id,
        'name', recent.name,
        'plan_name', recent.plan_name,
        'created_at', recent.created_at
      ) ORDER BY recent.created_at DESC, recent.id DESC)
      FROM (
        SELECT organization.id, organization.name, organization.created_at, plan.name AS plan_name
        FROM public.organizations AS organization
        LEFT JOIN LATERAL (
          SELECT subscription.plan_code
          FROM public.subscriptions AS subscription
          WHERE subscription.organization_id = organization.id
          ORDER BY subscription.created_at DESC, subscription.id DESC
          LIMIT 1
        ) AS latest_subscription ON true
        LEFT JOIN public.plans AS plan ON plan.code = latest_subscription.plan_code
        WHERE organization.created_at >= (SELECT value FROM week_start)
        ORDER BY organization.created_at DESC, organization.id DESC
      ) AS recent
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_overview_kpis() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_overview_kpis() TO service_role;
  END IF;
END
$$;
