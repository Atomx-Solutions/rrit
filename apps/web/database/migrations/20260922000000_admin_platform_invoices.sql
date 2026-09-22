-- RRIT-SA-11: a paginated revenue overview for superadmins. The function is
-- callable only with the service role; the /api/admin middleware verifies the
-- authenticated caller is a superadmin before the route reaches this query.
CREATE OR REPLACE FUNCTION public.admin_platform_invoices(
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 25,
  p_org_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_source_type text DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH params AS (
    SELECT
      GREATEST(COALESCE(p_page, 1), 1) AS page,
      LEAST(GREATEST(COALESCE(p_per_page, 25), 1), 200) AS per_page
  ),
  filtered AS (
    SELECT
      invoice.id,
      invoice.number,
      invoice.kind,
      invoice.status,
      invoice.issued_at,
      invoice.organization_id,
      organization.name AS organization_name,
      invoice.total_cents,
      invoice.subtotal_cents,
      invoice.vat_cents,
      invoice.source_type,
      invoice.currency,
      invoice.lines,
      invoice.sequence
    FROM public.invoices AS invoice
    JOIN public.organizations AS organization ON organization.id = invoice.organization_id
    WHERE (p_org_id IS NULL OR invoice.organization_id = p_org_id)
      AND (p_kind IS NULL OR invoice.kind = p_kind)
      AND (p_source_type IS NULL OR invoice.source_type = p_source_type)
      AND (p_from IS NULL OR invoice.issued_at >= p_from)
      -- `to` is inclusive for the complete UTC calendar day supplied by the admin.
      AND (p_to IS NULL OR invoice.issued_at < (p_to + 1))
  ),
  page_rows AS (
    SELECT filtered.*
    FROM filtered, params
    ORDER BY filtered.issued_at DESC, filtered.sequence DESC, filtered.id DESC
    LIMIT (SELECT per_page FROM params)
    OFFSET ((SELECT page FROM params) - 1) * (SELECT per_page FROM params)
  ),
  summary AS (
    SELECT
      COALESCE(SUM(total_cents) FILTER (WHERE kind = 'invoice'), 0::bigint) AS total_revenue_cents,
      COALESCE(SUM(total_cents) FILTER (WHERE kind = 'credit_note'), 0::bigint) AS total_credit_notes_cents,
      COALESCE(SUM(total_cents), 0::bigint) AS net_revenue_cents,
      COALESCE(SUM(total_cents) FILTER (
        WHERE kind = 'invoice' AND issued_at >= pg_catalog.date_trunc('month', CURRENT_TIMESTAMP)
      ), 0::bigint) AS this_month_cents
    FROM filtered
  )
  SELECT pg_catalog.jsonb_build_object(
    'invoices', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', row.id,
          'number', row.number,
          'kind', row.kind,
          'status', row.status,
          'issued_at', row.issued_at,
          'organization_id', row.organization_id,
          'organization_name', row.organization_name,
          'total_cents', row.total_cents,
          'subtotal_cents', row.subtotal_cents,
          'vat_cents', row.vat_cents,
          'source_type', row.source_type,
          'currency', row.currency,
          'lines', row.lines
        )
        ORDER BY row.issued_at DESC, row.sequence DESC, row.id DESC
      )
      FROM page_rows AS row
    ), '[]'::jsonb),
    'summary', (SELECT pg_catalog.jsonb_build_object(
      'total_revenue_cents', summary.total_revenue_cents,
      'total_credit_notes_cents', summary.total_credit_notes_cents,
      'net_revenue_cents', summary.net_revenue_cents,
      'this_month_cents', summary.this_month_cents
    ) FROM summary),
    'total', (SELECT pg_catalog.count(*) FROM filtered),
    'page', (SELECT page FROM params),
    'per_page', (SELECT per_page FROM params)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_platform_invoices(integer, integer, uuid, text, text, date, date) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_platform_invoices(integer, integer, uuid, text, text, date, date) TO service_role;
  END IF;
END
$$;
