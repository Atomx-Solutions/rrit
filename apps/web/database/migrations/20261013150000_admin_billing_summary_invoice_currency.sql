-- The old billing summary converted every CHF invoice back to an assumed EUR
-- base. Prices are now stored in the central platform currency, so summaries
-- must aggregate the invoice snapshots directly.
CREATE OR REPLACE FUNCTION public.admin_billing_invoices(
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 50,
  p_org_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_source_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_limit integer := LEAST(GREATEST(COALESCE(p_per_page, 50), 1), 200);
  v_offset integer := (v_page - 1) * v_limit;
  v_rows jsonb;
  v_total bigint;
  v_summary jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT i.id, i.number, i.kind, i.status, i.issued_at, i.organization_id,
           organization.name AS organization_name, i.total_cents,
           i.subtotal_cents, i.vat_cents, i.source_type, i.currency, i.lines
      FROM invoices AS i
      JOIN organizations AS organization ON organization.id = i.organization_id
     WHERE (p_org_id IS NULL OR i.organization_id = p_org_id)
       AND (p_kind IS NULL OR i.kind = p_kind)
       AND (p_source_type IS NULL OR i.source_type = p_source_type)
       AND (p_from IS NULL OR i.issued_at >= p_from)
       AND (p_to IS NULL OR i.issued_at < p_to)
     ORDER BY i.issued_at DESC, i.sequence DESC
     LIMIT v_limit OFFSET v_offset
  ) AS row;

  SELECT COUNT(*) INTO v_total
    FROM invoices AS i
   WHERE (p_org_id IS NULL OR i.organization_id = p_org_id)
     AND (p_kind IS NULL OR i.kind = p_kind)
     AND (p_source_type IS NULL OR i.source_type = p_source_type)
     AND (p_from IS NULL OR i.issued_at >= p_from)
     AND (p_to IS NULL OR i.issued_at < p_to);

  SELECT jsonb_build_object(
    'total_revenue_cents', COALESCE(SUM(i.total_cents) FILTER (WHERE i.kind = 'invoice'), 0),
    'total_credit_notes_cents', COALESCE(SUM(ABS(i.total_cents)) FILTER (WHERE i.kind = 'credit_note'), 0),
    'gross_revenue_cents', COALESCE(SUM(i.total_cents), 0),
    'net_revenue_cents', COALESCE(SUM(i.subtotal_cents), 0),
    'vat_cents', COALESCE(SUM(i.vat_cents), 0),
    'this_month_cents', (
      SELECT COALESCE(SUM(month_invoice.total_cents), 0)
        FROM invoices AS month_invoice
       WHERE (p_org_id IS NULL OR month_invoice.organization_id = p_org_id)
         AND month_invoice.issued_at >= date_trunc('month', now())
         AND month_invoice.issued_at < date_trunc('month', now()) + interval '1 month'
    ),
    'this_month_net_cents', (
      SELECT COALESCE(SUM(month_invoice.subtotal_cents), 0)
        FROM invoices AS month_invoice
       WHERE (p_org_id IS NULL OR month_invoice.organization_id = p_org_id)
         AND month_invoice.issued_at >= date_trunc('month', now())
         AND month_invoice.issued_at < date_trunc('month', now()) + interval '1 month'
    )
  ) INTO v_summary
    FROM invoices AS i
   WHERE (p_org_id IS NULL OR i.organization_id = p_org_id)
     AND (p_kind IS NULL OR i.kind = p_kind)
     AND (p_source_type IS NULL OR i.source_type = p_source_type)
     AND (p_from IS NULL OR i.issued_at >= p_from)
     AND (p_to IS NULL OR i.issued_at < p_to);

  RETURN jsonb_build_object('invoices', v_rows, 'summary', v_summary, 'total', v_total, 'page', v_page);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_billing_invoices(integer, integer, uuid, text, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_billing_invoices(integer, integer, uuid, text, text, timestamptz, timestamptz) TO service_role;
