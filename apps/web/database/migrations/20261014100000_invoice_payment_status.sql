-- Invoices are immutable documents, but whether the client has paid one is
-- state that changes after issue. It lives beside the invoice, is seen only by
-- the superadmin, and an invoice left unpaid past its due date pauses the
-- organization's package until the payment is recorded.

ALTER TABLE invoice_settings
  ADD COLUMN payment_terms_days integer NOT NULL DEFAULT 14
    CHECK (payment_terms_days BETWEEN 0 AND 365);

CREATE TABLE invoice_payments (
  invoice_id uuid PRIMARY KEY REFERENCES invoices(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('unpaid', 'paid')),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  method text CHECK (method IN ('cash', 'bank_transfer', 'card', 'other')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'paid' AND paid_at IS NOT NULL AND method IS NOT NULL)
      OR (status = 'unpaid' AND paid_at IS NULL AND method IS NULL))
);
CREATE INDEX invoice_payments_unpaid_due ON invoice_payments (organization_id, due_at)
  WHERE status = 'unpaid';

-- No policy for tenants: clients never read their payment state, the
-- superadmin reads it with the service role and the runtime only asks the
-- definer function below whether usage is paused.
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invoice_payments FROM PUBLIC;

-- Everything issued before payment tracking was settled outside the app.
INSERT INTO invoice_payments (invoice_id, organization_id, status, due_at, paid_at, method, note)
SELECT i.id, i.organization_id, 'paid', i.issued_at, i.issued_at, 'other',
       'Recorded as paid when payment tracking was introduced.'
  FROM invoices AS i
 WHERE i.kind = 'invoice'
ON CONFLICT (invoice_id) DO NOTHING;

-- Every new invoice starts unpaid, due after the configured payment terms.
-- Invoices are inserted from tenant transactions, so the trigger writes in the
-- schema of the invoice row rather than trusting the caller's search path.
CREATE OR REPLACE FUNCTION app.open_invoice_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.kind <> 'invoice' THEN
    RETURN NEW;
  END IF;
  EXECUTE pg_catalog.format(
    'INSERT INTO %1$I.invoice_payments (invoice_id, organization_id, status, due_at)
     SELECT $1, $2, ''unpaid'', $3 + pg_catalog.make_interval(days => s.payment_terms_days)
       FROM %1$I.invoice_settings AS s WHERE s.singleton
     ON CONFLICT (invoice_id) DO NOTHING',
    TG_TABLE_SCHEMA
  ) USING NEW.id, NEW.organization_id, NEW.issued_at;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION app.open_invoice_payment() FROM PUBLIC;

CREATE TRIGGER invoices_open_payment
  AFTER INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.open_invoice_payment();

-- Whether an organization has an invoice that is unpaid past its due date. An
-- invoice reversed by a credit note is no longer owed.
CREATE OR REPLACE FUNCTION app.organization_payment_overdue(p_organization_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  invoice_schema text := pg_catalog.current_schema();
  overdue boolean;
BEGIN
  IF invoice_schema IS NULL OR (
    invoice_schema <> 'public'
    AND invoice_schema !~ '^rrit_test_[a-f0-9]{32}$'
  ) THEN
    RAISE EXCEPTION 'Unsupported invoice schema';
  END IF;

  EXECUTE pg_catalog.format(
    'SELECT EXISTS (
       SELECT 1 FROM %1$I.invoice_payments AS p
        WHERE p.organization_id = $1
          AND p.status = ''unpaid''
          AND p.due_at <= pg_catalog.now()
          AND NOT EXISTS (
            SELECT 1 FROM %1$I.invoices AS credit
             WHERE credit.credited_invoice_id = p.invoice_id
          )
     )',
    invoice_schema
  ) INTO overdue USING p_organization_id;
  RETURN overdue;
END
$function$;
REVOKE ALL ON FUNCTION app.organization_payment_overdue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.organization_payment_overdue(uuid) TO app_runtime;

-- The superadmin records a payment, or takes back one recorded by mistake.
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
    NULL, after_row.organization_id, p_actor_id, 'admin_invoice_payment_change.update',
    'invoice_payment', p_invoice_id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_invoice_payment_change',
      'actor_email', p_actor_email,
      'before', pg_catalog.to_jsonb(before_row),
      'after', pg_catalog.to_jsonb(after_row)
    ),
    0
  );
  RETURN pg_catalog.to_jsonb(after_row);
END
$function$;
REVOKE ALL ON FUNCTION public.admin_set_invoice_payment(uuid, text, uuid, text, timestamptz, text, text) FROM PUBLIC;

-- The billing list gains each invoice's payment state, a payment filter and
-- the amounts still owed. A new parameter changes the signature, so the old
-- function is replaced rather than overloaded.
DROP FUNCTION IF EXISTS public.admin_billing_invoices(integer, integer, uuid, text, text, timestamptz, timestamptz);
CREATE FUNCTION public.admin_billing_invoices(
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
         END AS payment_status
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
           payment_status, due_at, paid_at, payment_method, payment_note
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
REVOKE ALL ON FUNCTION public.admin_billing_invoices(integer, integer, uuid, text, text, timestamptz, timestamptz, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON invoice_payments TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_set_invoice_payment(uuid, text, uuid, text, timestamptz, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_billing_invoices(integer, integer, uuid, text, text, timestamptz, timestamptz, text) TO service_role;
  END IF;
END
$$;
