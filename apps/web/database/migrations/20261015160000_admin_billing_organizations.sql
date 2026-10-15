-- Billing opens on the organizations that have invoices, each with its own
-- totals, before listing one organization's invoices. Amounts are returned per
-- currency so the server converts each before adding them up.
CREATE OR REPLACE FUNCTION public.admin_billing_organizations()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH rows AS (
    SELECT i.organization_id, i.currency, i.kind, i.total_cents, i.issued_at,
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
    'invoice_count', grouped.invoice_count,
    'gross_revenue_cents', grouped.gross,
    'outstanding_cents', grouped.outstanding,
    'overdue_cents', grouped.overdue,
    'overdue_count', grouped.overdue_count,
    'last_issued_at', grouped.last_issued_at
  )), '[]'::jsonb)
  FROM (
    SELECT organization_id, currency,
           pg_catalog.count(*) FILTER (WHERE kind = 'invoice')::integer AS invoice_count,
           COALESCE(pg_catalog.sum(total_cents), 0)::bigint AS gross,
           COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE payment_status IN ('unpaid', 'overdue')), 0)::bigint AS outstanding,
           COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE payment_status = 'overdue'), 0)::bigint AS overdue,
           pg_catalog.count(*) FILTER (WHERE payment_status = 'overdue')::integer AS overdue_count,
           pg_catalog.max(issued_at) AS last_issued_at
      FROM rows
     GROUP BY organization_id, currency
  ) AS grouped
  JOIN public.organizations AS organization ON organization.id = grouped.organization_id;
$function$;
REVOKE ALL ON FUNCTION public.admin_billing_organizations() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_billing_organizations() TO service_role;
  END IF;
END
$$;
