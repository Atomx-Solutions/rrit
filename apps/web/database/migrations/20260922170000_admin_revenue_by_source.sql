-- Revenue split between plan sales (activations and upgrades) and credit
-- top-ups, net of credit notes: a credit note counts against the source of
-- the invoice it reverses.
CREATE OR REPLACE FUNCTION public.admin_revenue_by_source()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH sales AS (
    SELECT
      CASE WHEN COALESCE(original.source_type, invoice.source_type) = 'credit_top_up' THEN 'credits' ELSE 'plans' END AS source,
      invoice.total_cents,
      invoice.issued_at >= pg_catalog.date_trunc('month', pg_catalog.now()) AS this_month
    FROM public.invoices AS invoice
    LEFT JOIN public.invoices AS original ON original.id = invoice.credited_invoice_id
  )
  SELECT pg_catalog.jsonb_build_object(
    'plans_total_cents', COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE source = 'plans'), 0)::bigint,
    'plans_this_month_cents', COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE source = 'plans' AND this_month), 0)::bigint,
    'credits_total_cents', COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE source = 'credits'), 0)::bigint,
    'credits_this_month_cents', COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE source = 'credits' AND this_month), 0)::bigint
  )
  FROM sales;
$function$;

REVOKE ALL ON FUNCTION public.admin_revenue_by_source() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_revenue_by_source() TO service_role;
  END IF;
END
$$;
