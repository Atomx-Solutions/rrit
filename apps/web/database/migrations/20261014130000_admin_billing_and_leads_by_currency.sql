-- The billing page totals carry the same mix of currencies. This returns them
-- per currency for the same filters as admin_billing_invoices, so the server
-- converts each part before showing one figure.
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
    SELECT i.currency, i.kind, i.total_cents, i.subtotal_cents, i.vat_cents,
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
    'gross_revenue_cents', gross,
    'net_revenue_cents', net,
    'vat_cents', vat,
    'outstanding_cents', outstanding,
    'overdue_cents', overdue
  )), '[]'::jsonb)
  FROM (
    SELECT currency,
           COALESCE(pg_catalog.sum(total_cents), 0)::bigint AS gross,
           COALESCE(pg_catalog.sum(subtotal_cents), 0)::bigint AS net,
           COALESCE(pg_catalog.sum(vat_cents), 0)::bigint AS vat,
           COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE payment_status IN ('unpaid', 'overdue')), 0)::bigint AS outstanding,
           COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE payment_status = 'overdue'), 0)::bigint AS overdue
      FROM rows
     GROUP BY currency
  ) AS grouped;
$function$;
REVOKE ALL ON FUNCTION public.admin_billing_summary_by_currency(uuid, text, text, timestamptz, timestamptz) FROM PUBLIC;

-- Won leads are valued from their invoice, their package or the current
-- rates; each of those has its own currency, so the value is split by it.
CREATE OR REPLACE FUNCTION public.admin_package_request_conversion_value_by_currency(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('currency', currency, 'cents', cents)), '[]'::jsonb)
  FROM (
    SELECT COALESCE(invoice.currency, package.currency, settings.package_currency) AS currency,
           pg_catalog.sum(COALESCE(
             invoice.subtotal_cents,
             package.price_cents,
             COALESCE(lead.posts_requested, 0) * settings.custom_package_post_price_cents
               + COALESCE(lead.videos_requested, 0) * settings.custom_package_video_price_cents
               + COALESCE(lead.credits_requested, 0) * pricing.credit_price_cents
           ))::bigint AS cents
      FROM public.package_requests lead
      LEFT JOIN public.custom_packages package ON package.package_request_id = lead.id
      LEFT JOIN public.invoices invoice
        ON invoice.source_type = 'custom_package'
       AND invoice.source_reference = package.id::text
       AND invoice.kind = 'invoice'
      CROSS JOIN public.platform_settings settings
      CROSS JOIN public.credit_pricing pricing
     WHERE lead.status = 'won'
       AND lead.created_at >= p_from AND lead.created_at < p_to
       AND pricing.singleton = true
       AND settings.singleton = true
     GROUP BY 1
  ) AS grouped;
$function$;
REVOKE ALL ON FUNCTION public.admin_package_request_conversion_value_by_currency(timestamptz, timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_billing_summary_by_currency(uuid, text, text, timestamptz, timestamptz) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_package_request_conversion_value_by_currency(timestamptz, timestamptz) TO service_role;
  END IF;
END
$$;
