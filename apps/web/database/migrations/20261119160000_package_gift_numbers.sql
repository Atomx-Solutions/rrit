-- A gift is numbered in the same series as the invoices (FRAMIC-YYYY-NNNNNN),
-- so every document a client receives has a number; only its status says it
-- was given free of charge. It still adds no revenue.

ALTER TABLE public.package_gifts
  ADD COLUMN IF NOT EXISTS number text UNIQUE,
  ADD COLUMN IF NOT EXISTS year integer,
  ADD COLUMN IF NOT EXISTS sequence integer;

CREATE OR REPLACE FUNCTION app.record_package_gift(
  p_package public.custom_packages, p_value_cents integer, p_description text, p_source_type text,
  p_reason text, p_actor_id uuid, p_actor_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- public first: app.next_invoice_sequence reads current_schema().
SET search_path = public, pg_catalog
AS $function$
DECLARE
  new_id uuid;
  prefix text;
  gift_year integer := pg_catalog.date_part('year', pg_catalog.now())::integer;
  seq integer;
BEGIN
  IF p_value_cents <= 0 THEN RETURN NULL; END IF;
  SELECT number_prefix INTO prefix FROM public.invoice_settings WHERE singleton = true;
  IF prefix IS NULL THEN RAISE EXCEPTION 'INVOICE_SETTINGS_MISSING' USING ERRCODE = 'P0001'; END IF;
  seq := app.next_invoice_sequence(gift_year);
  INSERT INTO public.package_gifts
    (organization_id, package_id, value_cents, currency, source_type, description, reason,
     actor_id, actor_email, number, year, sequence)
  VALUES
    (p_package.organization_id, p_package.id, p_value_cents, p_package.currency, p_source_type,
     p_description, pg_catalog.btrim(p_reason), p_actor_id, p_actor_email,
     prefix || '-' || gift_year::text || '-' || pg_catalog.lpad(seq::text, 6, '0'), gift_year, seq)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$function$;
REVOKE ALL ON FUNCTION app.record_package_gift(public.custom_packages, integer, text, text, text, uuid, text) FROM PUBLIC;

-- Number the gifts recorded before this change, oldest first.
DO $$
DECLARE
  gift record;
  prefix text;
  seq integer;
BEGIN
  PERFORM pg_catalog.set_config('search_path', 'public, pg_catalog', true);
  SELECT number_prefix INTO prefix FROM public.invoice_settings WHERE singleton = true;
  FOR gift IN SELECT id, created_at FROM public.package_gifts WHERE number IS NULL ORDER BY created_at LOOP
    seq := app.next_invoice_sequence(pg_catalog.date_part('year', gift.created_at)::integer);
    UPDATE public.package_gifts
       SET number = prefix || '-' || pg_catalog.date_part('year', gift.created_at)::integer::text
                    || '-' || pg_catalog.lpad(seq::text, 6, '0'),
           year = pg_catalog.date_part('year', gift.created_at)::integer,
           sequence = seq
     WHERE id = gift.id;
  END LOOP;
END
$$;

ALTER TABLE public.package_gifts
  ALTER COLUMN number SET NOT NULL,
  ALTER COLUMN year SET NOT NULL,
  ALTER COLUMN sequence SET NOT NULL;

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

  CREATE TEMP TABLE listed_rows ON COMMIT DROP AS
  SELECT id, number, kind, status, issued_at, organization_id, organization_name,
         total_cents, subtotal_cents, vat_cents, source_type, currency, lines,
         payment_status, due_at, paid_at, payment_method, payment_note, paid_by_paddle,
         NULL::text AS gift_reason, NULL::text AS gift_actor_email, sequence::bigint AS sort_key
    FROM billing_rows
   WHERE p_payment IS NULL OR payment_status = p_payment
  UNION ALL
  SELECT gift.id, gift.number, 'gift', 'gift', gift.created_at, gift.organization_id, organization.name,
         gift.value_cents, gift.value_cents, 0, gift.source_type, gift.currency,
         jsonb_build_array(jsonb_build_object('description', gift.description, 'quantity', 1,
                                              'unitPriceCents', gift.value_cents, 'totalCents', gift.value_cents)),
         NULL, NULL, NULL, NULL, NULL, false,
         gift.reason, gift.actor_email, gift.sequence
    FROM package_gifts AS gift
    JOIN organizations AS organization ON organization.id = gift.organization_id
   WHERE p_payment IS NULL
     AND (p_kind IS NULL OR p_kind = 'gift')
     AND (p_org_id IS NULL OR gift.organization_id = p_org_id)
     AND (p_source_type IS NULL OR gift.source_type = p_source_type)
     AND (p_from IS NULL OR gift.created_at >= p_from)
     AND (p_to IS NULL OR gift.created_at < p_to);

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT id, number, kind, status, issued_at, organization_id, organization_name,
           total_cents, subtotal_cents, vat_cents, source_type, currency, lines,
           payment_status, due_at, paid_at, payment_method, payment_note, paid_by_paddle,
           gift_reason, gift_actor_email
      FROM listed_rows
     ORDER BY issued_at DESC, sort_key DESC
     LIMIT v_limit OFFSET v_offset
  ) AS row;

  SELECT COUNT(*) INTO v_total FROM listed_rows;

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
         AND month_invoice.issued_at >= admin_period_start('month')
    ),
    'this_month_net_cents', (
      SELECT COALESCE(SUM(month_invoice.subtotal_cents), 0)
        FROM invoices AS month_invoice
       WHERE (p_org_id IS NULL OR month_invoice.organization_id = p_org_id)
         AND month_invoice.issued_at >= admin_period_start('month')
    )
  ) INTO v_summary
    FROM billing_rows AS b;

  DROP TABLE listed_rows;
  DROP TABLE billing_rows;
  RETURN jsonb_build_object('invoices', v_rows, 'summary', v_summary, 'total', v_total, 'page', v_page);
END
$function$;

-- What an admin gave the business lately, for its notifications: gifts and the
-- additions invoiced on a running package. Read only for the business itself.
CREATE OR REPLACE FUNCTION app.recent_admin_grants(p_days integer DEFAULT 14)
RETURNS TABLE (id uuid, kind text, description text, value_cents integer, currency text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT gift.id, 'gift', gift.description, gift.value_cents, gift.currency, gift.created_at
    FROM public.package_gifts AS gift
   WHERE gift.organization_id = app.current_organization_id()
     AND gift.created_at >= pg_catalog.now() - pg_catalog.make_interval(days => p_days)
  UNION ALL
  SELECT invoice.id, 'addition', invoice.lines->0->>'description', invoice.subtotal_cents, invoice.currency, invoice.issued_at
    FROM public.invoices AS invoice
   WHERE invoice.organization_id = app.current_organization_id()
     AND invoice.kind = 'invoice'
     AND invoice.source_reference LIKE '%:%'
     AND invoice.issued_at >= pg_catalog.now() - pg_catalog.make_interval(days => p_days)
   ORDER BY 6 DESC
   LIMIT 5;
$function$;
REVOKE ALL ON FUNCTION app.recent_admin_grants(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.recent_admin_grants(integer) TO app_runtime;
