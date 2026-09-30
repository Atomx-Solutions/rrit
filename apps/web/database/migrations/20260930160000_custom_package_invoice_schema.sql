-- app.next_invoice_sequence refuses to run unless the current schema is the one
-- holding the invoices, and it reads that from current_schema(). A search path
-- that starts at pg_catalog reports pg_catalog, so the numbering was rejected.
-- Listing public first makes the function run in the schema it is numbering,
-- exactly as the application does when it issues an invoice itself.
CREATE OR REPLACE FUNCTION public.admin_issue_custom_package_invoice(p_package_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
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
