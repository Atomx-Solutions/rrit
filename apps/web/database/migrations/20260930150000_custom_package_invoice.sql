-- A package sold for cash still needs a record of what was agreed. Creating one
-- now issues an invoice for it, in the same transaction, so a package can never
-- exist without the proof of its terms.
--
-- The invoice stays on the superadmin side. The tenant has no route to invoices
-- at all, so this is a document the team holds and hands over when the customer
-- asks for it, not something that appears in their account.

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_source_type_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_source_type_check CHECK (
    source_type IN ('subscription_activation', 'subscription_upgrade', 'credit_top_up',
                    'credit_note', 'custom_package')
  );

-- Mirrors issueInvoice in the application: same numbering, same VAT rounding,
-- same seller and buyer snapshot. It exists in SQL so the invoice and the
-- package are written together or not at all.
CREATE OR REPLACE FUNCTION public.admin_issue_custom_package_invoice(p_package_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  package_row public.custom_packages%ROWTYPE;
  settings public.invoice_settings%ROWTYPE;
  buyer_name text;
  buyer_address text;
  buyer_city text;
  buyer_country text;
  buyer_fiscal text;
  issued timestamptz := pg_catalog.now();
  year integer;
  seq integer;
  subtotal integer;
  vat integer;
  existing uuid;
  new_id uuid;
BEGIN
  SELECT * INTO package_row FROM public.custom_packages WHERE id = p_package_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- One invoice per package: re-running this never issues a second one.
  SELECT id INTO existing FROM public.invoices
   WHERE organization_id = package_row.organization_id
     AND source_type = 'custom_package'
     AND source_reference = p_package_id::text;
  IF FOUND THEN
    RETURN existing;
  END IF;

  SELECT * INTO settings FROM public.invoice_settings WHERE singleton = true;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(details.legal_name, organization.name), COALESCE(details.address, ''),
         COALESCE(details.city, ''), COALESCE(details.country, ''), COALESCE(details.fiscal_number, '')
    INTO buyer_name, buyer_address, buyer_city, buyer_country, buyer_fiscal
    FROM public.organizations AS organization
    LEFT JOIN public.organization_billing_details AS details
      ON details.organization_id = organization.id
   WHERE organization.id = package_row.organization_id;

  -- The agreed total is what is charged, so it is the line total. The per-post
  -- rate is carried in the description, where it explains that total.
  subtotal := package_row.price_cents;
  vat := pg_catalog.round((subtotal::numeric * settings.vat_rate_basis_points) / 10000)::integer;
  year := pg_catalog.date_part('year', issued)::integer;
  seq := app.next_invoice_sequence(year);

  INSERT INTO public.invoices
    (organization_id, number, year, sequence, kind, issued_at, seller, buyer, lines,
     subtotal_cents, vat_rate_basis_points, vat_cents, total_cents, source_type, source_reference)
  VALUES (
    package_row.organization_id,
    settings.number_prefix || '-' || year::text || '-' || pg_catalog.lpad(seq::text, 6, '0'),
    year, seq, 'invoice', issued,
    pg_catalog.jsonb_build_object(
      'name', settings.seller_name,
      'address', settings.seller_address,
      'fiscalNumber', settings.seller_fiscal_number
    ),
    pg_catalog.jsonb_build_object(
      'name', buyer_name, 'address', buyer_address, 'city', buyer_city,
      'country', buyer_country, 'fiscalNumber', buyer_fiscal
    ),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'description', package_row.name || ' — ' || package_row.posts_included::text
        || ' postime × ' || pg_catalog.to_char(package_row.post_price_cents / 100.0, 'FM999990.00') || ' EUR',
      'quantity', 1,
      'unitPriceCents', subtotal,
      'totalCents', subtotal
    )),
    subtotal, settings.vat_rate_basis_points, vat, subtotal + vat,
    'custom_package', p_package_id::text
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_issue_custom_package_invoice(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_issue_custom_package_invoice(uuid) TO service_role;
  END IF;
END
$$;

-- Creating a package now issues its invoice before returning.
CREATE OR REPLACE FUNCTION public.admin_create_custom_package(
  p_organization_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_package jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  created_row public.custom_packages%ROWTYPE;
  posts_included integer := (p_package->>'posts_included')::integer;
  rate integer;
  suggested integer;
  invoice_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  rate := COALESCE(
    (p_package->>'post_price_cents')::integer,
    public.admin_custom_package_post_rate()
  );
  suggested := posts_included * rate;

  BEGIN
    INSERT INTO public.custom_packages
      (organization_id, name, posts_included, post_price_cents, price_cents,
       suggested_price_cents, starts_at, ends_at, status, notes)
    VALUES (
      p_organization_id,
      p_package->>'name',
      posts_included,
      rate,
      COALESCE((p_package->>'price_cents')::integer, suggested),
      suggested,
      (p_package->>'starts_at')::timestamptz,
      (p_package->>'ends_at')::timestamptz,
      p_package->>'status',
      p_package->>'notes'
    )
    RETURNING * INTO created_row;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE = 'P0001';
    WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
      RAISE EXCEPTION 'PACKAGE_INVALID' USING ERRCODE = 'P0001';
  END;

  invoice_id := public.admin_issue_custom_package_invoice(created_row.id);

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    p_organization_id, p_organization_id, p_actor_id, 'admin_custom_package.create',
    'custom_package', created_row.id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_custom_package_change',
      'actor_email', p_actor_email,
      'changes', p_package,
      'after', pg_catalog.to_jsonb(created_row),
      'invoice_id', invoice_id
    ),
    0
  );
  RETURN pg_catalog.to_jsonb(created_row)
    || pg_catalog.jsonb_build_object('invoice_id', invoice_id);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_create_custom_package(uuid, uuid, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_create_custom_package(uuid, uuid, text, jsonb) TO service_role;
  END IF;
END
$$;
