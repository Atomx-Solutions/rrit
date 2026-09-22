-- RRIT-SA-12: what the platform spent at the AI provider, for the superadmin.
--
-- Provider spend comes from two ledgers: ai_cost_ledger (caption generation,
-- counted when status = 'committed') and monthly_ai_runs (research, planning,
-- post copy, images and quality review, counted when status = 'completed').
-- Reading only ai_cost_ledger would miss almost all real spend.
--
-- Money: one credit is sold for credit_price_cents and costs
-- provider_cost_per_credit_micro_eur at the provider (PRC-08). Revenue is the
-- credits customers consumed in the range; margin = revenue - provider cost.
CREATE OR REPLACE FUNCTION public.admin_ai_costs(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH calls AS (
    SELECT
      ledger.business_id,
      ledger.model,
      'captions'::text AS source,
      COALESCE(ledger.actual_cost_micro_eur, 0)::bigint AS cost,
      COALESCE(ledger.actual_input_tokens, 0)::bigint AS input_tokens,
      COALESCE(ledger.actual_output_tokens, 0)::bigint AS output_tokens,
      ledger.settled_at AS at
    FROM public.ai_cost_ledger AS ledger
    WHERE ledger.status = 'committed' AND ledger.settled_at IS NOT NULL
    UNION ALL
    SELECT
      run.business_id,
      run.model,
      'monthly_planner'::text,
      COALESCE(run.actual_cost_micro_eur, 0)::bigint,
      -- result holds whole provider responses, images included; reading it for
      -- every run takes over a minute, so tokens are read only for text runs
      -- inside the range (image runs are billed per image, not per token).
      CASE WHEN run.completed_at >= p_from AND run.completed_at < p_to AND run.model NOT ILIKE '%image%'
        THEN COALESCE((run.result->'usage'->>'input_tokens')::bigint, 0) ELSE 0 END,
      CASE WHEN run.completed_at >= p_from AND run.completed_at < p_to AND run.model NOT ILIKE '%image%'
        THEN COALESCE((run.result->'usage'->>'output_tokens')::bigint, 0) ELSE 0 END,
      run.completed_at
    FROM public.monthly_ai_runs AS run
    WHERE run.status = 'completed' AND run.completed_at IS NOT NULL
  ),
  in_range AS MATERIALIZED (
    SELECT * FROM calls WHERE at >= p_from AND at < p_to
  ),
  consumed AS (
    SELECT entry.organization_id, (-entry.credit_delta)::bigint AS credits
    FROM public.credit_ledger AS entry
    WHERE entry.event_type = 'consume' AND entry.created_at >= p_from AND entry.created_at < p_to
  ),
  pricing AS (
    SELECT credit_price_cents, provider_cost_per_credit_micro_eur FROM public.credit_pricing WHERE singleton
  ),
  totals AS (
    SELECT
      COALESCE(pg_catalog.sum(cost), 0)::bigint AS cost,
      pg_catalog.count(*)::bigint AS calls,
      (SELECT COALESCE(pg_catalog.sum(credits), 0)::bigint FROM consumed) AS credits
    FROM in_range
  )
  SELECT pg_catalog.jsonb_build_object(
    'range', pg_catalog.jsonb_build_object('from', p_from, 'to', p_to),
    'summary', (
      SELECT pg_catalog.jsonb_build_object(
        'total_cost_micro_eur', totals.cost,
        'this_month_cost_micro_eur', (
          SELECT COALESCE(pg_catalog.sum(ledger.actual_cost_micro_eur), 0)::bigint FROM public.ai_cost_ledger AS ledger
          WHERE ledger.status = 'committed' AND ledger.settled_at >= pg_catalog.date_trunc('month', pg_catalog.now())
        ) + (
          SELECT COALESCE(pg_catalog.sum(run.actual_cost_micro_eur), 0)::bigint FROM public.monthly_ai_runs AS run
          WHERE run.status = 'completed' AND run.completed_at >= pg_catalog.date_trunc('month', pg_catalog.now())
        ),
        'total_calls', totals.calls,
        'total_credits_consumed', totals.credits,
        'margin_analysis', pg_catalog.jsonb_build_object(
          'revenue_from_credits_cents', totals.credits * pricing.credit_price_cents,
          'provider_cost_cents', pg_catalog.round(totals.cost / 10000.0)::bigint,
          'margin_cents', totals.credits * pricing.credit_price_cents - pg_catalog.round(totals.cost / 10000.0)::bigint
        )
      )
      FROM totals, pricing
    ),
    'by_source', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('source', source, 'calls', calls, 'cost_micro_eur', cost) ORDER BY cost DESC)
      FROM (SELECT source, pg_catalog.count(*) AS calls, pg_catalog.sum(cost)::bigint AS cost FROM in_range GROUP BY source) AS grouped
    ), '[]'::jsonb),
    'by_model', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'model', model, 'calls', calls, 'cost_micro_eur', cost,
        'input_tokens', input_tokens, 'output_tokens', output_tokens
      ) ORDER BY cost DESC, model)
      FROM (
        SELECT model, pg_catalog.count(*) AS calls, pg_catalog.sum(cost)::bigint AS cost,
          pg_catalog.sum(input_tokens)::bigint AS input_tokens, pg_catalog.sum(output_tokens)::bigint AS output_tokens
        FROM in_range GROUP BY model
      ) AS grouped
    ), '[]'::jsonb),
    'by_organization', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'organization_id', grouped.organization_id,
        'organization_name', organization.name,
        'calls', grouped.calls,
        'cost_micro_eur', grouped.cost,
        'credits_consumed', grouped.credits
      ) ORDER BY grouped.cost DESC, organization.name)
      FROM (
        SELECT
          COALESCE(usage.organization_id, credits.organization_id) AS organization_id,
          COALESCE(usage.calls, 0) AS calls,
          COALESCE(usage.cost, 0) AS cost,
          COALESCE(credits.credits, 0) AS credits
        FROM (
          SELECT business_id AS organization_id, pg_catalog.count(*) AS calls, pg_catalog.sum(cost)::bigint AS cost
          FROM in_range GROUP BY business_id
        ) AS usage
        FULL JOIN (
          SELECT organization_id, pg_catalog.sum(credits)::bigint AS credits FROM consumed GROUP BY organization_id
        ) AS credits ON credits.organization_id = usage.organization_id
      ) AS grouped
      LEFT JOIN public.organizations AS organization ON organization.id = grouped.organization_id
    ), '[]'::jsonb),
    -- Every day of the range, ascending, with zeros on days without calls.
    'daily', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'date', pg_catalog.to_char(series_day, 'YYYY-MM-DD'),
        'cost_micro_eur', COALESCE(stats.cost, 0),
        'calls', COALESCE(stats.calls, 0)
      ) ORDER BY series_day)
      FROM pg_catalog.generate_series(
        (p_from AT TIME ZONE 'UTC')::date, ((p_to AT TIME ZONE 'UTC') - interval '1 microsecond')::date, interval '1 day'
      ) AS series_day
      LEFT JOIN (
        SELECT (at AT TIME ZONE 'UTC')::date AS day, pg_catalog.sum(cost)::bigint AS cost, pg_catalog.count(*) AS calls
        FROM in_range GROUP BY 1
      ) AS stats ON stats.day = series_day::date
    ), '[]'::jsonb),
    'provider_config', (
      SELECT pg_catalog.jsonb_build_object(
        'token_price_cents', credit_price_cents,
        'provider_token_cost_micro_eur', provider_cost_per_credit_micro_eur
      ) FROM pricing
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_ai_costs(timestamptz, timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_ai_costs(timestamptz, timestamptz) TO service_role;
  END IF;
END
$$;
