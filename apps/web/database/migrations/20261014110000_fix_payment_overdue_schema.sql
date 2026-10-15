-- The overdue check resolves its tables from the caller's schema, like
-- app.next_invoice_sequence. A fixed search_path made current_schema() report
-- pg_catalog, so every call was refused; every name below is qualified, so the
-- function needs no search_path of its own.
CREATE OR REPLACE FUNCTION app.organization_payment_overdue(p_organization_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
ALTER FUNCTION app.organization_payment_overdue(uuid) RESET search_path;
REVOKE ALL ON FUNCTION app.organization_payment_overdue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.organization_payment_overdue(uuid) TO app_runtime;

-- A payment change is a superadmin action on an invoice, not work inside a
-- business, so it is recorded like the other platform-scope admin changes,
-- with the organization kept in the metadata.
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_scope_check;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_scope_check CHECK (
    (organization_id IS NOT NULL AND business_id IS NOT NULL)
    OR (organization_id IS NULL AND business_id IS NULL
        AND resource_type IN (
          'plan',
          'credit_pricing',
          'invoice_settings',
          'platform_settings',
          'package_request',
          'custom_package',
          'organization_invitation',
          'invoice_payment'
        ))
  );

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
