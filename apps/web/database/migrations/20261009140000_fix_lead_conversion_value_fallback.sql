-- Count the value of won leads even when older packages were not linked via
-- package_request_id. Newer packages have an invoice whose source_reference
-- is the package id; use that as the authoritative value when available.
CREATE OR REPLACE FUNCTION public.admin_package_request_conversion_summary(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $function$
  WITH leads AS (
    SELECT * FROM public.package_requests
    WHERE created_at >= p_from AND created_at < p_to
  ), conversion_value AS (
    SELECT COALESCE(sum(COALESCE(
      invoice.subtotal_cents,
      package.price_cents,
      COALESCE(lead.posts_requested, 0) * settings.custom_package_post_price_cents
        + COALESCE(lead.videos_requested, 0) * settings.custom_package_video_price_cents
        + COALESCE(lead.credits_requested, 0) * pricing.credit_price_cents
    )), 0)::bigint AS cents
    FROM public.package_requests lead
    LEFT JOIN public.custom_packages package ON package.package_request_id = lead.id
    LEFT JOIN public.invoices invoice
      ON invoice.source_type = 'custom_package'
     AND invoice.source_reference = package.id::text
     AND invoice.kind = 'invoice'
    CROSS JOIN public.platform_settings settings
    CROSS JOIN public.credit_pricing pricing
    WHERE lead.status = 'won'
      AND lead.converted_at >= p_from
      AND lead.converted_at < p_to
      AND pricing.singleton = true
  )
  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'new', count(*) FILTER (WHERE status = 'new')::integer,
    'contacted', count(*) FILTER (WHERE status = 'contacted')::integer,
    'proposal_sent', count(*) FILTER (WHERE status = 'proposal_sent')::integer,
    'won', count(*) FILTER (WHERE status = 'won')::integer,
    'lost', count(*) FILTER (WHERE status = 'lost')::integer,
    'conversion_value_cents', (SELECT cents FROM conversion_value)
  ) FROM leads;
$function$;
