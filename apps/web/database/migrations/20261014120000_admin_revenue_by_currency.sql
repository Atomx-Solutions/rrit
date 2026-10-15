-- Invoices are issued in more than one currency, so adding their amounts
-- together without the currency mixes francs and euros. The overview reads the
-- sales split by currency and converts each part to the superadmin's currency.
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
      invoice.subtotal_cents,
      invoice.vat_cents,
      invoice.issued_at >= pg_catalog.date_trunc('month', pg_catalog.now()) AS this_month
    FROM public.invoices AS invoice
    LEFT JOIN public.invoices AS original ON original.id = invoice.credited_invoice_id
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'source', source,
    'currency', currency,
    'total_cents', total_cents,
    'this_month_cents', this_month_cents,
    'vat_total_cents', vat_total_cents,
    'vat_this_month_cents', vat_this_month_cents
  )), '[]'::jsonb)
  FROM (
    SELECT source, currency,
           pg_catalog.sum(subtotal_cents)::bigint AS total_cents,
           COALESCE(pg_catalog.sum(subtotal_cents) FILTER (WHERE this_month), 0)::bigint AS this_month_cents,
           pg_catalog.sum(vat_cents)::bigint AS vat_total_cents,
           COALESCE(pg_catalog.sum(vat_cents) FILTER (WHERE this_month), 0)::bigint AS vat_this_month_cents
      FROM sales
     GROUP BY source, currency
  ) AS grouped;
$function$;
REVOKE ALL ON FUNCTION public.admin_revenue_by_source_currency() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_revenue_by_source_currency() TO service_role;
  END IF;
END
$$;
