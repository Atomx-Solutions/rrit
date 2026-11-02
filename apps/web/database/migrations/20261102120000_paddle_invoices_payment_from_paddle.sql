-- An invoice for a Paddle payment opens paid, because Paddle collected the
-- money and its webhook issued the invoice. Its payment status therefore comes
-- from Paddle alone: the superadmin can no longer mark it unpaid by hand, and
-- the invoice list says which invoices are Paddle's so no button is offered.
CREATE OR REPLACE FUNCTION public.admin_set_invoice_payment(
  p_actor_id uuid,
  p_actor_email text,
  p_invoice_id uuid,
  p_status text,
  p_paid_at timestamptz DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.invoice_payments%ROWTYPE;
  after_row public.invoice_payments%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.invoice_payments WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_PAYMENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Paddle collected this payment and reports it; a hand-set status would
  -- contradict the record of money that actually moved.
  IF EXISTS (
    SELECT 1 FROM public.invoices AS invoice
      JOIN public.paddle_payment_orders AS paddle_order
        ON paddle_order.paddle_transaction_id = invoice.source_reference
     WHERE invoice.id = p_invoice_id
  ) THEN
    RAISE EXCEPTION 'INVOICE_PAYMENT_MANAGED_BY_PADDLE' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.invoice_payments SET
      status = p_status,
      paid_at = CASE WHEN p_status = 'paid' THEN COALESCE(p_paid_at, pg_catalog.now()) END,
      method = CASE WHEN p_status = 'paid' THEN p_method END,
      note = NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), ''),
      updated_by = p_actor_id,
      updated_at = pg_catalog.now()
    WHERE invoice_id = p_invoice_id
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'INVOICE_PAYMENT_INVALID' USING ERRCODE = 'P0001';
  END;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    NULL, NULL, p_actor_id, 'admin_invoice_payment_change.update',
    'invoice_payment', p_invoice_id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_invoice_payment_change',
      'actor_email', p_actor_email,
      'organization_id', after_row.organization_id,
      'before', pg_catalog.to_jsonb(before_row),
      'after', pg_catalog.to_jsonb(after_row)
    ),
    0
  );
  RETURN pg_catalog.to_jsonb(after_row);
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_billing_invoices(
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 50,
  p_org_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_source_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_payment text DEFAULT NULL
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
  CREATE TEMP TABLE billing_rows ON COMMIT DROP AS
  SELECT i.*, organization.name AS organization_name,
         payment.due_at, payment.paid_at, payment.method AS payment_method, payment.note AS payment_note,
         CASE
           WHEN payment.invoice_id IS NULL THEN NULL
           WHEN EXISTS (SELECT 1 FROM invoices AS credit WHERE credit.credited_invoice_id = i.id) THEN 'credited'
           WHEN payment.status = 'paid' THEN 'paid'
           WHEN payment.due_at <= now() THEN 'overdue'
           ELSE 'unpaid'
         END AS payment_status,
         EXISTS (
           SELECT 1 FROM paddle_payment_orders AS paddle_order
            WHERE paddle_order.paddle_transaction_id = i.source_reference
         ) AS paid_by_paddle
    FROM invoices AS i
    JOIN organizations AS organization ON organization.id = i.organization_id
    LEFT JOIN invoice_payments AS payment ON payment.invoice_id = i.id
   WHERE (p_org_id IS NULL OR i.organization_id = p_org_id)
     AND (p_kind IS NULL OR i.kind = p_kind)
     AND (p_source_type IS NULL OR i.source_type = p_source_type)
     AND (p_from IS NULL OR i.issued_at >= p_from)
     AND (p_to IS NULL OR i.issued_at < p_to);

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT id, number, kind, status, issued_at, organization_id, organization_name,
           total_cents, subtotal_cents, vat_cents, source_type, currency, lines,
           payment_status, due_at, paid_at, payment_method, payment_note, paid_by_paddle
      FROM billing_rows
     WHERE p_payment IS NULL OR payment_status = p_payment
     ORDER BY issued_at DESC, sequence DESC
     LIMIT v_limit OFFSET v_offset
  ) AS row;

  SELECT COUNT(*) INTO v_total FROM billing_rows
   WHERE p_payment IS NULL OR payment_status = p_payment;

  SELECT jsonb_build_object(
    'total_revenue_cents', COALESCE(SUM(b.total_cents) FILTER (WHERE b.kind = 'invoice'), 0),
    'total_credit_notes_cents', COALESCE(SUM(ABS(b.total_cents)) FILTER (WHERE b.kind = 'credit_note'), 0),
    'gross_revenue_cents', COALESCE(SUM(b.total_cents), 0),
    'net_revenue_cents', COALESCE(SUM(b.subtotal_cents), 0),
    'vat_cents', COALESCE(SUM(b.vat_cents), 0),
    'outstanding_cents', COALESCE(SUM(b.total_cents) FILTER (WHERE b.payment_status IN ('unpaid', 'overdue')), 0),
    'overdue_cents', COALESCE(SUM(b.total_cents) FILTER (WHERE b.payment_status = 'overdue'), 0),
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
    FROM billing_rows AS b;

  DROP TABLE billing_rows;
  RETURN jsonb_build_object('invoices', v_rows, 'summary', v_summary, 'total', v_total, 'page', v_page);
END
$function$;
