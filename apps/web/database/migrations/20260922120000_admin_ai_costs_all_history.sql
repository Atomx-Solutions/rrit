-- The historical view must not inspect the large monthly_ai_runs.result JSON
-- payload. Legacy rows without normalized token counts show 0 / 0 instead of
-- causing the admin report to exceed PostgreSQL's statement timeout.
CREATE OR REPLACE FUNCTION public.admin_ai_costs(
  p_from timestamptz, p_to timestamptz, p_current_key text,
  p_only_current boolean DEFAULT true
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  WITH ledger_base AS (
    SELECT ledger.business_id, COALESCE(ledger.provider_model, ledger.model) AS model,
      'captions'::text AS source, COALESCE(ledger.actual_cost_micro_eur, 0)::bigint AS cost,
      COALESCE(ledger.provider_input_tokens, ledger.actual_input_tokens, 0)::bigint AS input_tokens,
      COALESCE(ledger.provider_output_tokens, ledger.actual_output_tokens, 0)::bigint AS output_tokens,
      ledger.settled_at AS at, ledger.provider_key_fingerprint AS key_fingerprint
    FROM public.ai_cost_ledger AS ledger
    WHERE ledger.status = 'committed' AND ledger.settled_at IS NOT NULL
      AND ledger.settled_at >= p_from AND ledger.settled_at < p_to
  ), monthly_base AS (
    SELECT run.business_id, COALESCE(run.provider_model, run.model) AS model,
      'monthly_planner'::text AS source, COALESCE(run.actual_cost_micro_eur, 0)::bigint AS cost,
      COALESCE(run.provider_input_tokens, 0)::bigint AS input_tokens,
      COALESCE(run.provider_output_tokens, 0)::bigint AS output_tokens,
      run.completed_at AS at, run.provider_key_fingerprint AS key_fingerprint
    FROM public.monthly_ai_runs AS run
    WHERE run.status = 'completed' AND run.completed_at IS NOT NULL
      AND run.completed_at >= p_from AND run.completed_at < p_to
  ), in_range_all AS MATERIALIZED (
    SELECT business_id, model, source, cost, at, key_fingerprint FROM ledger_base
    UNION ALL
    SELECT business_id, model, source, cost, at, key_fingerprint FROM monthly_base
  ), in_range AS (
    SELECT business_id, model, source, cost, input_tokens, output_tokens, at, key_fingerprint
    FROM ledger_base
    UNION ALL
    SELECT business_id, model, source, cost, input_tokens, output_tokens, at, key_fingerprint
    FROM monthly_base
    WHERE NOT p_only_current OR key_fingerprint = p_current_key
  ), consumed AS (
    SELECT entry.organization_id, (-entry.credit_delta)::bigint AS credits
    FROM public.credit_ledger AS entry
    WHERE entry.event_type = 'consume' AND entry.created_at >= p_from AND entry.created_at < p_to
  ), pricing AS (
    SELECT credit_price_cents, provider_cost_per_credit_micro_eur
    FROM public.credit_pricing WHERE singleton
  ), totals AS (
    SELECT COALESCE(pg_catalog.sum(cost), 0)::bigint AS cost, pg_catalog.count(*)::bigint AS calls,
      (SELECT COALESCE(pg_catalog.sum(credits), 0)::bigint FROM consumed) AS credits
    FROM in_range
  ), current_month AS (
    SELECT COALESCE(pg_catalog.sum(cost), 0)::bigint AS cost FROM (
      SELECT COALESCE(ledger.actual_cost_micro_eur, 0)::bigint AS cost
      FROM public.ai_cost_ledger AS ledger
      WHERE ledger.status = 'committed' AND ledger.settled_at >= pg_catalog.date_trunc('month', pg_catalog.now())
        AND ledger.settled_at < pg_catalog.now() + interval '1 day'
      UNION ALL
      SELECT COALESCE(run.actual_cost_micro_eur, 0)::bigint FROM public.monthly_ai_runs AS run
      WHERE run.status = 'completed' AND run.completed_at >= pg_catalog.date_trunc('month', pg_catalog.now())
        AND run.completed_at < pg_catalog.now() + interval '1 day'
        AND (NOT p_only_current OR run.provider_key_fingerprint = p_current_key)
    ) AS month_calls
  )
  SELECT pg_catalog.jsonb_build_object(
    'range', pg_catalog.jsonb_build_object('from', p_from, 'to', p_to),
    'summary', (SELECT pg_catalog.jsonb_build_object(
      'total_cost_micro_eur', totals.cost, 'this_month_cost_micro_eur', current_month.cost,
      'total_calls', totals.calls, 'total_credits_consumed', totals.credits,
      'margin_analysis', pg_catalog.jsonb_build_object(
        'revenue_from_credits_cents', totals.credits * pricing.credit_price_cents,
        'provider_cost_cents', pg_catalog.round(totals.cost / 10000.0)::bigint,
        'margin_cents', totals.credits * pricing.credit_price_cents - pg_catalog.round(totals.cost / 10000.0)::bigint
      )) FROM totals, current_month, pricing),
    'scope', CASE WHEN p_only_current THEN 'platform' ELSE 'all' END,
    'by_environment', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'environment', environment, 'calls', calls, 'cost_micro_eur', cost) ORDER BY environment)
      FROM (SELECT CASE WHEN key_fingerprint = p_current_key THEN 'platform' WHEN key_fingerprint IS NULL THEN 'unknown' ELSE 'other' END AS environment,
        pg_catalog.count(*) AS calls, pg_catalog.sum(cost)::bigint AS cost FROM in_range_all GROUP BY 1) AS grouped), '[]'::jsonb),
    'by_source', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'source', source, 'calls', calls, 'cost_micro_eur', cost) ORDER BY cost DESC)
      FROM (SELECT source, pg_catalog.count(*) AS calls, pg_catalog.sum(cost)::bigint AS cost FROM in_range GROUP BY source) AS grouped), '[]'::jsonb),
    'by_model', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'model', model, 'calls', calls, 'cost_micro_eur', cost, 'input_tokens', input_tokens, 'output_tokens', output_tokens) ORDER BY cost DESC, model)
      FROM (SELECT model, pg_catalog.count(*) AS calls, pg_catalog.sum(cost)::bigint AS cost,
        pg_catalog.sum(input_tokens)::bigint AS input_tokens, pg_catalog.sum(output_tokens)::bigint AS output_tokens
        FROM in_range GROUP BY model) AS grouped), '[]'::jsonb),
    'by_organization', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'organization_id', grouped.organization_id, 'organization_name', organization.name, 'calls', grouped.calls,
      'cost_micro_eur', grouped.cost, 'credits_consumed', grouped.credits) ORDER BY grouped.cost DESC, organization.name)
      FROM (SELECT COALESCE(usage.organization_id, credits.organization_id) AS organization_id,
        COALESCE(usage.calls, 0) AS calls, COALESCE(usage.cost, 0) AS cost, COALESCE(credits.credits, 0) AS credits
        FROM (SELECT business_id AS organization_id, pg_catalog.count(*) AS calls, pg_catalog.sum(cost)::bigint AS cost FROM in_range GROUP BY business_id) AS usage
        FULL JOIN (SELECT organization_id, pg_catalog.sum(credits)::bigint AS credits FROM consumed GROUP BY organization_id) AS credits
        ON credits.organization_id = usage.organization_id) AS grouped
      LEFT JOIN public.organizations AS organization ON organization.id = grouped.organization_id), '[]'::jsonb),
    'daily', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'date', pg_catalog.to_char(series_day, 'YYYY-MM-DD'), 'cost_micro_eur', COALESCE(stats.cost, 0), 'calls', COALESCE(stats.calls, 0)) ORDER BY series_day)
      FROM pg_catalog.generate_series((p_from AT TIME ZONE 'UTC')::date, ((p_to AT TIME ZONE 'UTC') - interval '1 microsecond')::date, interval '1 day') AS series_day
      LEFT JOIN (SELECT (at AT TIME ZONE 'UTC')::date AS day, pg_catalog.sum(cost)::bigint AS cost, pg_catalog.count(*) AS calls FROM in_range GROUP BY 1) AS stats
      ON stats.day = series_day::date), '[]'::jsonb),
    'provider_config', (SELECT pg_catalog.jsonb_build_object('token_price_cents', credit_price_cents,
      'provider_token_cost_micro_eur', provider_cost_per_credit_micro_eur) FROM pricing)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_ai_costs(timestamptz, timestamptz, text, boolean) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_ai_costs(timestamptz, timestamptz, text, boolean) TO service_role;
  END IF;
END $$;
