-- Admin report fixes.
--
-- 1. A won lead is worth what was really invoiced for it, net of credit notes,
--    or its package price while nothing is invoiced yet. It is no longer
--    estimated from the requested quantities at today's prices, a package with
--    several invoices is counted once per invoice only, and a cancelled
--    invoice no longer counts.
-- 2. Every amount is returned with the day it was invoiced (rate_date), so the
--    server converts it at that day's rate instead of today's.
-- 3. Months, weeks and days are counted in the admin's time zone, not in UTC.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS reporting_timezone text NOT NULL DEFAULT 'Europe/Zurich';

CREATE OR REPLACE FUNCTION public.admin_reporting_timezone()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE((SELECT reporting_timezone FROM public.platform_settings WHERE singleton), 'UTC');
$function$;
REVOKE ALL ON FUNCTION public.admin_reporting_timezone() FROM PUBLIC;

/** The instant the current month or week started in the admin's time zone. */
CREATE OR REPLACE FUNCTION public.admin_period_start(p_unit text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.date_trunc(p_unit, pg_catalog.now() AT TIME ZONE public.admin_reporting_timezone())
         AT TIME ZONE public.admin_reporting_timezone();
$function$;
REVOKE ALL ON FUNCTION public.admin_period_start(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_overview_kpis()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH month_start AS (
    SELECT public.admin_period_start('month') AS value
  ),
  week_start AS (
    SELECT public.admin_period_start('week') AS value
  ),
  organization_states AS (
    SELECT
      organization.id,
      latest_subscription.status
    FROM public.claimed_organizations AS organization
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
      'total', (SELECT pg_catalog.count(*) FROM public.claimed_organizations),
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
        FROM public.claimed_organizations AS organization
        WHERE organization.created_at >= (SELECT value FROM week_start)
      ),
      'this_month', (
        SELECT pg_catalog.count(*)
        FROM public.claimed_organizations AS organization
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
        FROM public.claimed_organizations AS organization
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

CREATE OR REPLACE FUNCTION public.admin_revenue_by_source_currency()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH sales AS (
    SELECT
      CASE
        WHEN COALESCE(original.source_type, invoice.source_type) = 'credit_top_up' THEN 'credits'
        WHEN COALESCE(original.source_type, invoice.source_type) = 'video_purchase' THEN 'videos'
        ELSE 'plans'
      END AS source,
      invoice.currency,
      (invoice.issued_at AT TIME ZONE public.admin_reporting_timezone())::date AS rate_date,
      invoice.subtotal_cents,
      invoice.vat_cents,
      invoice.issued_at >= public.admin_period_start('month') AS this_month
    FROM public.invoices AS invoice
    LEFT JOIN public.invoices AS original ON original.id = invoice.credited_invoice_id
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'source', source,
    'currency', currency,
    'rate_date', rate_date,
    'total_cents', total_cents,
    'this_month_cents', this_month_cents,
    'vat_total_cents', vat_total_cents,
    'vat_this_month_cents', vat_this_month_cents
  )), '[]'::jsonb)
  FROM (
    SELECT source, currency, rate_date,
           pg_catalog.sum(subtotal_cents)::bigint AS total_cents,
           COALESCE(pg_catalog.sum(subtotal_cents) FILTER (WHERE this_month), 0)::bigint AS this_month_cents,
           pg_catalog.sum(vat_cents)::bigint AS vat_total_cents,
           COALESCE(pg_catalog.sum(vat_cents) FILTER (WHERE this_month), 0)::bigint AS vat_this_month_cents
      FROM sales
     GROUP BY source, currency, rate_date
  ) AS grouped;
$function$;

CREATE OR REPLACE FUNCTION public.admin_billing_summary_by_currency(
  p_org_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_source_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH rows AS (
    SELECT i.currency, (i.issued_at AT TIME ZONE public.admin_reporting_timezone())::date AS rate_date,
           i.kind, i.total_cents, i.subtotal_cents, i.vat_cents,
           CASE
             WHEN payment.invoice_id IS NULL THEN NULL
             WHEN EXISTS (SELECT 1 FROM public.invoices AS credit WHERE credit.credited_invoice_id = i.id) THEN 'credited'
             WHEN payment.status = 'paid' THEN 'paid'
             WHEN payment.due_at <= pg_catalog.now() THEN 'overdue'
             ELSE 'unpaid'
           END AS payment_status
      FROM public.invoices AS i
      LEFT JOIN public.invoice_payments AS payment ON payment.invoice_id = i.id
     WHERE (p_org_id IS NULL OR i.organization_id = p_org_id)
       AND (p_kind IS NULL OR i.kind = p_kind)
       AND (p_source_type IS NULL OR i.source_type = p_source_type)
       AND (p_from IS NULL OR i.issued_at >= p_from)
       AND (p_to IS NULL OR i.issued_at < p_to)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'currency', currency,
    'rate_date', rate_date,
    'gross_revenue_cents', gross,
    'net_revenue_cents', net,
    'vat_cents', vat,
    'outstanding_cents', outstanding,
    'overdue_cents', overdue
  )), '[]'::jsonb)
  FROM (
    SELECT currency, rate_date,
           COALESCE(pg_catalog.sum(total_cents), 0)::bigint AS gross,
           COALESCE(pg_catalog.sum(subtotal_cents), 0)::bigint AS net,
           COALESCE(pg_catalog.sum(vat_cents), 0)::bigint AS vat,
           COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE payment_status IN ('unpaid', 'overdue')), 0)::bigint AS outstanding,
           COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE payment_status = 'overdue'), 0)::bigint AS overdue
      FROM rows
     GROUP BY currency, rate_date
  ) AS grouped;
$function$;

CREATE OR REPLACE FUNCTION public.admin_billing_organizations()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH rows AS (
    SELECT i.organization_id, i.currency,
           (i.issued_at AT TIME ZONE public.admin_reporting_timezone())::date AS rate_date,
           i.kind, i.total_cents, i.issued_at,
           CASE
             WHEN payment.invoice_id IS NULL THEN NULL
             WHEN EXISTS (SELECT 1 FROM public.invoices AS credit WHERE credit.credited_invoice_id = i.id) THEN 'credited'
             WHEN payment.status = 'paid' THEN 'paid'
             WHEN payment.due_at <= pg_catalog.now() THEN 'overdue'
             ELSE 'unpaid'
           END AS payment_status
      FROM public.invoices AS i
      LEFT JOIN public.invoice_payments AS payment ON payment.invoice_id = i.id
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'organization_id', grouped.organization_id,
    'organization_name', organization.name,
    'currency', grouped.currency,
    'rate_date', grouped.rate_date,
    'invoice_count', grouped.invoice_count,
    'gross_revenue_cents', grouped.gross,
    'outstanding_cents', grouped.outstanding,
    'overdue_cents', grouped.overdue,
    'overdue_count', grouped.overdue_count,
    'last_issued_at', grouped.last_issued_at
  )), '[]'::jsonb)
  FROM (
    SELECT organization_id, currency, rate_date,
           pg_catalog.count(*) FILTER (WHERE kind = 'invoice')::integer AS invoice_count,
           COALESCE(pg_catalog.sum(total_cents), 0)::bigint AS gross,
           COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE payment_status IN ('unpaid', 'overdue')), 0)::bigint AS outstanding,
           COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE payment_status = 'overdue'), 0)::bigint AS overdue,
           pg_catalog.count(*) FILTER (WHERE payment_status = 'overdue')::integer AS overdue_count,
           pg_catalog.max(issued_at) AS last_issued_at
      FROM rows
     GROUP BY organization_id, currency, rate_date
  ) AS grouped
  JOIN public.organizations AS organization ON organization.id = grouped.organization_id;
$function$;

CREATE OR REPLACE FUNCTION public.admin_package_request_conversion_value_by_currency(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  WITH won_packages AS (
    SELECT package.id, package.price_cents, package.currency, package.created_at
      FROM public.package_requests AS lead
      JOIN public.custom_packages AS package ON package.package_request_id = lead.id
     WHERE lead.status = 'won'
       AND lead.created_at >= p_from AND lead.created_at < p_to
  ), invoiced AS (
    -- Every invoice of a package together with its credit notes, so a
    -- cancelled invoice adds nothing.
    SELECT package.id AS package_id, entry.currency, entry.subtotal_cents,
           (entry.issued_at AT TIME ZONE public.admin_reporting_timezone())::date AS rate_date
      FROM won_packages AS package
      JOIN public.invoices AS invoice
        ON invoice.source_type = 'custom_package'
       AND invoice.source_reference = package.id::text
       AND invoice.kind = 'invoice'
      JOIN public.invoices AS entry
        ON entry.id = invoice.id OR entry.credited_invoice_id = invoice.id
  ), valued AS (
    SELECT currency, rate_date, subtotal_cents AS cents FROM invoiced
    UNION ALL
    -- A package with no invoice yet is worth its agreed price.
    SELECT COALESCE(package.currency, settings.package_currency),
           (package.created_at AT TIME ZONE public.admin_reporting_timezone())::date,
           package.price_cents
      FROM won_packages AS package
      CROSS JOIN public.platform_settings AS settings
     WHERE settings.singleton
       AND NOT EXISTS (SELECT 1 FROM invoiced WHERE invoiced.package_id = package.id)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'currency', currency, 'rate_date', rate_date, 'cents', cents
  )), '[]'::jsonb)
  FROM (
    SELECT currency, rate_date, pg_catalog.sum(cents)::bigint AS cents
      FROM valued
     GROUP BY currency, rate_date
  ) AS grouped;
$function$;

-- The value is read per currency above. The old single sum here added francs
-- and euros together, so it is no longer returned.
CREATE OR REPLACE FUNCTION public.admin_package_request_conversion_summary(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'new', count(*) FILTER (WHERE status = 'new')::integer,
    'contacted', count(*) FILTER (WHERE status = 'contacted')::integer,
    'proposal_sent', count(*) FILTER (WHERE status = 'proposal_sent')::integer,
    'won', count(*) FILTER (WHERE status = 'won')::integer,
    'lost', count(*) FILTER (WHERE status = 'lost')::integer
  )
  FROM public.package_requests
  WHERE created_at >= p_from AND created_at < p_to;
$function$;
