-- 20261006260000 added the video line to admin_issue_custom_package_invoice by
-- rebuilding it from the 20261002170000 copy, and so undid the three fixes that
-- shipped after it: the `public, pg_catalog` search path that lets
-- app.next_invoice_sequence see the schema it is numbering, the credit_top_up
-- source type, the English line wording, and the zero-total case that returns
-- without issuing. Accepting any proposal failed on the first of those.
--
-- This starts from 20261002230000, the newest version, and adds videos to it.
CREATE OR REPLACE FUNCTION public.admin_issue_custom_package_invoice(p_package_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- public first: app.next_invoice_sequence reads current_schema() and refuses
-- to number invoices when that reports pg_catalog.
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
  posts_total integer;
  videos_total integer;
  credits_total integer;
  vat integer;
  lines jsonb := pg_catalog.jsonb_build_array();
  existing uuid;
  new_id uuid;
  invoice_source text;
BEGIN
  SELECT * INTO package_row FROM public.custom_packages WHERE id = p_package_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- A package that carries neither posts nor videos is a pure credit top-up.
  invoice_source := CASE
    WHEN package_row.posts_included = 0 AND package_row.videos_included = 0 THEN 'credit_top_up'
    ELSE 'custom_package'
  END;

  -- One invoice per package: re-running this never issues a second one.
  SELECT id INTO existing FROM public.invoices
   WHERE organization_id = package_row.organization_id
     AND source_type = invoice_source
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

  -- The agreed total is what is charged. Posts and videos are priced at their
  -- own agreed rates, and whatever those rates leave over goes to the credits
  -- when the package carries them, or to the deliverable it does carry when it
  -- does not.
  subtotal := package_row.price_cents;
  IF subtotal <= 0 THEN
    RETURN NULL;
  END IF;
  posts_total := package_row.posts_included * package_row.post_price_cents;
  videos_total := package_row.videos_included * package_row.video_price_cents;
  IF package_row.credits_included = 0 THEN
    credits_total := 0;
    IF package_row.videos_included = 0 OR posts_total + videos_total > subtotal THEN
      IF package_row.posts_included = 0 THEN
        posts_total := 0;
        videos_total := subtotal;
      ELSIF package_row.videos_included = 0 THEN
        videos_total := 0;
        posts_total := subtotal;
      ELSE
        posts_total := LEAST(posts_total, subtotal);
        videos_total := subtotal - posts_total;
      END IF;
    ELSE
      -- Rounding the rates do not account for stays with the posts, so the
      -- lines always add up to the agreed total.
      posts_total := subtotal - videos_total;
    END IF;
  ELSE
    IF posts_total + videos_total > subtotal THEN
      posts_total := LEAST(posts_total, subtotal);
      videos_total := subtotal - posts_total;
    END IF;
    credits_total := subtotal - posts_total - videos_total;
  END IF;

  IF package_row.posts_included > 0 THEN
    lines := lines || pg_catalog.jsonb_build_object(
      'description', package_row.name || ' — ' || package_row.posts_included::text
        || CASE WHEN package_row.posts_included = 1 THEN ' post × ' ELSE ' posts × ' END
        || pg_catalog.to_char(package_row.post_price_cents / 100.0, 'FM999990.00') || ' EUR',
      'quantity', 1,
      'unitPriceCents', posts_total,
      'totalCents', posts_total
    );
  END IF;

  IF package_row.videos_included > 0 THEN
    lines := lines || pg_catalog.jsonb_build_object(
      'description', package_row.name || ' — ' || package_row.videos_included::text
        || CASE WHEN package_row.videos_included = 1 THEN ' video × ' ELSE ' videos × ' END
        || pg_catalog.to_char(package_row.video_price_cents / 100.0, 'FM999990.00') || ' EUR',
      'quantity', 1,
      'unitPriceCents', videos_total,
      'totalCents', videos_total
    );
  END IF;

  IF package_row.credits_included > 0 THEN
    lines := lines || pg_catalog.jsonb_build_object(
      'description', package_row.credits_included::text
        || CASE WHEN package_row.credits_included = 1 THEN ' credit' ELSE ' credits' END,
      'quantity', 1,
      'unitPriceCents', credits_total,
      'totalCents', credits_total
    );
  END IF;

  IF pg_catalog.jsonb_array_length(lines) = 0 THEN
    RETURN NULL;
  END IF;

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
    lines,
    subtotal, settings.vat_rate_basis_points, vat, subtotal + vat,
    invoice_source, p_package_id::text
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
