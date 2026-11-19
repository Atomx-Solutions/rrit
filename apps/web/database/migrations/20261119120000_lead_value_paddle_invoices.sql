-- An invoice paid through Paddle references its Paddle transaction (txn_...),
-- not the package id, so a won lead never found it and was valued at its
-- package price instead. The package is now matched through its payment
-- order as well, so a Paddle invoice, and a credit note against it, count.
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
  ), package_references AS (
    SELECT id AS package_id, id::text AS reference FROM won_packages
    UNION
    SELECT payment_order.package_id, payment_order.paddle_transaction_id
      FROM public.paddle_payment_orders AS payment_order
      JOIN won_packages AS package ON package.id = payment_order.package_id
     WHERE payment_order.paddle_transaction_id IS NOT NULL
  ), invoiced AS (
    -- Every invoice of a package together with its credit notes, so a
    -- cancelled invoice adds nothing.
    SELECT reference.package_id, entry.currency, entry.subtotal_cents,
           (entry.issued_at AT TIME ZONE public.admin_reporting_timezone())::date AS rate_date
      FROM package_references AS reference
      JOIN public.invoices AS invoice
        ON invoice.source_type = 'custom_package'
       AND invoice.source_reference = reference.reference
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
