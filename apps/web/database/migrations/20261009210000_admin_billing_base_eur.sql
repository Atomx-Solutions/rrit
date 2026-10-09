-- Billing summary separates gross (with VAT) and net (without VAT) revenue,
-- both after credit notes, and reports the VAT collected.
CREATE OR REPLACE FUNCTION admin_billing_invoices(
  p_page        integer   DEFAULT 1,
  p_per_page    integer   DEFAULT 50,
  p_org_id      uuid      DEFAULT NULL,
  p_kind        text      DEFAULT NULL,
  p_source_type text      DEFAULT NULL,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page    integer := GREATEST(COALESCE(p_page, 1), 1);
  v_limit   integer := LEAST(GREATEST(COALESCE(p_per_page, 50), 1), 200);
  v_offset  integer := (v_page - 1) * v_limit;
  v_rows    jsonb;
  v_total   bigint;
  v_summary jsonb;
BEGIN
  -- Paginated invoice rows with organization name
  SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      i.id,
      i.number,
      i.kind,
      i.status,
      i.issued_at,
      i.organization_id,
      o.name AS organization_name,
      i.total_cents,
      i.subtotal_cents,
      i.vat_cents,
      i.source_type,
      i.currency,
      i.lines
    FROM invoices i
    JOIN organizations o ON o.id = i.organization_id
    WHERE (p_org_id      IS NULL OR i.organization_id = p_org_id)
      AND (p_kind        IS NULL OR i.kind = p_kind)
      AND (p_source_type IS NULL OR i.source_type = p_source_type)
      AND (p_from        IS NULL OR i.issued_at >= p_from)
      AND (p_to          IS NULL OR i.issued_at <  p_to)
    ORDER BY i.issued_at DESC, i.sequence DESC
    LIMIT  v_limit
    OFFSET v_offset
  ) r;

  -- Total count (all pages)
  SELECT COUNT(*)
  INTO v_total
  FROM invoices i
  WHERE (p_org_id      IS NULL OR i.organization_id = p_org_id)
    AND (p_kind        IS NULL OR i.kind = p_kind)
    AND (p_source_type IS NULL OR i.source_type = p_source_type)
    AND (p_from        IS NULL OR i.issued_at >= p_from)
    AND (p_to          IS NULL OR i.issued_at <  p_to);

  -- Summary over ALL matching invoices (ignores pagination). Credit notes are
  -- stored negative, so a plain SUM already subtracts refunds.
  --   gross = with VAT, net = without VAT (subtotal), vat = the difference.
  SELECT jsonb_build_object(
    'total_revenue_cents',
      COALESCE(SUM(COALESCE(i.base_total_cents, CASE WHEN i.currency = 'CHF' THEN round(i.total_cents / 0.93) ELSE i.total_cents END)) FILTER (WHERE i.kind = 'invoice'), 0),
    'total_credit_notes_cents',
      COALESCE(SUM(ABS(i.total_cents)) FILTER (WHERE i.kind = 'credit_note'), 0),
    'gross_revenue_cents', COALESCE(SUM(COALESCE(i.base_total_cents, CASE WHEN i.currency = 'CHF' THEN round(i.total_cents / 0.93) ELSE i.total_cents END)), 0),
    'net_revenue_cents',   COALESCE(SUM(COALESCE(i.base_subtotal_cents, CASE WHEN i.currency = 'CHF' THEN round(i.subtotal_cents / 0.93) ELSE i.subtotal_cents END)), 0),
    'vat_cents',           COALESCE(SUM(COALESCE(i.base_vat_cents, CASE WHEN i.currency = 'CHF' THEN round(i.vat_cents / 0.93) ELSE i.vat_cents END)), 0),
    'this_month_cents', (
      -- Current calendar month, only org filter (date filters don't affect it)
      SELECT COALESCE(SUM(COALESCE(m.base_total_cents, CASE WHEN m.currency = 'CHF' THEN round(m.total_cents / 0.93) ELSE m.total_cents END)), 0)
      FROM invoices m
      WHERE (p_org_id IS NULL OR m.organization_id = p_org_id)
        AND m.issued_at >= date_trunc('month', now())
        AND m.issued_at <  date_trunc('month', now()) + interval '1 month'
    ),
    'this_month_net_cents', (
      SELECT COALESCE(SUM(COALESCE(m.base_subtotal_cents, CASE WHEN m.currency = 'CHF' THEN round(m.subtotal_cents / 0.93) ELSE m.subtotal_cents END)), 0)
      FROM invoices m
      WHERE (p_org_id IS NULL OR m.organization_id = p_org_id)
        AND m.issued_at >= date_trunc('month', now())
        AND m.issued_at <  date_trunc('month', now()) + interval '1 month'
    )
  )
  INTO v_summary
  FROM invoices i
  WHERE (p_org_id      IS NULL OR i.organization_id = p_org_id)
    AND (p_kind        IS NULL OR i.kind = p_kind)
    AND (p_source_type IS NULL OR i.source_type = p_source_type)
    AND (p_from        IS NULL OR i.issued_at >= p_from)
    AND (p_to          IS NULL OR i.issued_at <  p_to);

  RETURN jsonb_build_object(
    'invoices', v_rows,
    'summary',  v_summary,
    'total',    v_total,
    'page',     v_page
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_billing_invoices(integer, integer, uuid, text, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_billing_invoices(integer, integer, uuid, text, text, timestamptz, timestamptz) TO service_role;

