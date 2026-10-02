-- Buying credits is not a product of its own: it joins the custom package the
-- organization already runs. A top-up is therefore an ordinary package
-- proposal that carries credits instead of posts, and the existing accept flow
-- merges it into the active package. That gives it the request, the proposal,
-- the acceptance, the invoice and the audit trail that packages already have,
-- and it ties the credits to the package they were bought for.

ALTER TABLE public.custom_packages
  ADD COLUMN IF NOT EXISTS credits_included integer NOT NULL DEFAULT 0;
ALTER TABLE public.custom_packages
  DROP CONSTRAINT IF EXISTS custom_packages_credits_included_check;
ALTER TABLE public.custom_packages
  ADD CONSTRAINT custom_packages_credits_included_check
    CHECK (credits_included >= 0 AND credits_included <= 10000000);

-- A credit-only proposal carries no posts, so the lower bound moves to zero
-- and a separate check keeps an empty proposal impossible.
ALTER TABLE public.custom_packages
  DROP CONSTRAINT IF EXISTS custom_packages_posts_included_check;
ALTER TABLE public.custom_packages
  ADD CONSTRAINT custom_packages_posts_included_check
    CHECK (posts_included >= 0 AND posts_included <= 1000);
ALTER TABLE public.custom_packages
  DROP CONSTRAINT IF EXISTS custom_packages_offers_something_check;
ALTER TABLE public.custom_packages
  ADD CONSTRAINT custom_packages_offers_something_check
    CHECK (posts_included > 0 OR credits_included > 0);

ALTER TABLE public.package_requests
  ADD COLUMN IF NOT EXISTS credits_requested integer NOT NULL DEFAULT 0;
ALTER TABLE public.package_requests
  DROP CONSTRAINT IF EXISTS package_requests_credits_requested_check;
ALTER TABLE public.package_requests
  ADD CONSTRAINT package_requests_credits_requested_check
    CHECK (credits_requested >= 0 AND credits_requested <= 10000000);
ALTER TABLE public.package_requests
  DROP CONSTRAINT IF EXISTS package_requests_posts_requested_check;
ALTER TABLE public.package_requests
  ADD CONSTRAINT package_requests_posts_requested_check
    CHECK (posts_requested >= 0 AND posts_requested <= 1000);
ALTER TABLE public.package_requests
  DROP CONSTRAINT IF EXISTS package_requests_asks_for_something_check;
ALTER TABLE public.package_requests
  ADD CONSTRAINT package_requests_asks_for_something_check
    CHECK (posts_requested > 0 OR credits_requested > 0);
-- Credits are bought for a package that is already running, so a credit
-- request only exists inside the application.
ALTER TABLE public.package_requests
  DROP CONSTRAINT IF EXISTS package_requests_credits_need_organization_check;
ALTER TABLE public.package_requests
  ADD CONSTRAINT package_requests_credits_need_organization_check
    CHECK (credits_requested = 0 OR organization_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.client_decide_custom_package_proposal(p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  proposal public.custom_packages%ROWTYPE;
  active public.custom_packages%ROWTYPE;
  invoice_id uuid;
  credit_grant_id uuid;
  credits_per_post integer;
  granted_credits integer;
BEGIN
  SELECT * INTO proposal
    FROM public.custom_packages
   WHERE organization_id = app.current_organization_id()
     AND status = 'draft'
   ORDER BY created_at DESC, id DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_PROPOSAL_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF NOT p_accept THEN
    UPDATE public.custom_packages
       SET status = 'cancelled', updated_at = pg_catalog.now()
     WHERE id = proposal.id
     RETURNING * INTO proposal;
    UPDATE public.package_requests
       SET status = 'lost', handled_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE id = proposal.package_request_id;
    RETURN pg_catalog.to_jsonb(proposal) || pg_catalog.jsonb_build_object('invoice_id', invoice_id);
  END IF;

  SELECT custom_package_credits_per_post INTO credits_per_post
    FROM public.platform_settings
   WHERE singleton;
  IF credits_per_post IS NULL THEN
    RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO active
    FROM public.custom_packages
   WHERE organization_id = proposal.organization_id
     AND status = 'active'
     AND id <> proposal.id
   ORDER BY ends_at DESC, id DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.custom_packages
       SET posts_included = active.posts_included + proposal.posts_included,
           credits_included = active.credits_included + proposal.credits_included,
           price_cents = active.price_cents + proposal.price_cents,
           suggested_price_cents = active.suggested_price_cents + proposal.suggested_price_cents,
           -- Buying credits does not buy time: a top-up carries no posts and
           -- must never push the package end date out.
           ends_at = CASE
             WHEN proposal.posts_included = 0 THEN active.ends_at
             ELSE GREATEST(active.ends_at, proposal.ends_at)
           END,
           updated_at = pg_catalog.now()
     WHERE id = active.id;

    UPDATE public.custom_packages
       SET status = 'merged',
           parent_package_id = active.id,
           updated_at = pg_catalog.now()
     WHERE id = proposal.id
     RETURNING * INTO proposal;
  ELSE
    -- Credits belong to a package. Without one there is nothing to join, and
    -- a package of pure credits would grant AI with no posts to spend it on.
    IF proposal.posts_included = 0 THEN
      RAISE EXCEPTION 'ACTIVE_PACKAGE_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      UPDATE public.custom_packages
         SET status = 'active', updated_at = pg_catalog.now()
       WHERE id = proposal.id
       RETURNING * INTO proposal;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE = 'P0001';
    END;
  END IF;

  granted_credits := proposal.posts_included * credits_per_post + proposal.credits_included;

  INSERT INTO public.credit_balances (organization_id)
  VALUES (proposal.organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO public.credit_ledger
    (organization_id, event_type, credit_delta, reference_type, reference_id, idempotency_key, metadata)
  VALUES
    (
      proposal.organization_id,
      'grant',
      granted_credits,
      'custom_package',
      proposal.id::text,
      'custom-package-credit-grant:' || proposal.id::text,
      pg_catalog.jsonb_build_object(
        'posts_included', proposal.posts_included,
        'credits_per_post', credits_per_post,
        'credits_included', proposal.credits_included
      )
    )
  ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO credit_grant_id;

  IF credit_grant_id IS NOT NULL THEN
    UPDATE public.credit_balances
       SET remaining_credits = remaining_credits + granted_credits,
           updated_at = pg_catalog.now()
     WHERE organization_id = proposal.organization_id;
  END IF;

  invoice_id := public.admin_issue_custom_package_invoice(proposal.id);

  UPDATE public.package_requests
     SET status = 'won', handled_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE id = proposal.package_request_id;

  RETURN pg_catalog.to_jsonb(proposal) || pg_catalog.jsonb_build_object('invoice_id', invoice_id);
END $function$;

REVOKE ALL ON FUNCTION public.client_decide_custom_package_proposal(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_decide_custom_package_proposal(boolean) TO app_runtime;

-- The invoice must say what was actually bought. A package that carries both
-- posts and credits gets a line for each, and a pure top-up gets only the
-- credit line, so a customer reading the invoice can see where the money went.
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
  posts_total integer;
  credits_total integer;
  vat integer;
  lines jsonb := pg_catalog.jsonb_build_array();
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

  -- The agreed total is what is charged. When the package carries both posts
  -- and credits, the posts are priced at their own agreed rate and the credits
  -- take the remainder, so the lines always add up to the agreed total.
  subtotal := package_row.price_cents;
  posts_total := package_row.posts_included * package_row.post_price_cents;
  IF package_row.credits_included = 0 THEN
    posts_total := subtotal;
  ELSIF posts_total > subtotal THEN
    posts_total := subtotal;
  END IF;
  credits_total := subtotal - posts_total;

  IF package_row.posts_included > 0 THEN
    lines := lines || pg_catalog.jsonb_build_object(
      'description', package_row.name || ' — ' || package_row.posts_included::text
        || ' postime × ' || pg_catalog.to_char(package_row.post_price_cents / 100.0, 'FM999990.00') || ' EUR',
      'quantity', 1,
      'unitPriceCents', posts_total,
      'totalCents', posts_total
    );
  END IF;

  IF package_row.credits_included > 0 THEN
    lines := lines || pg_catalog.jsonb_build_object(
      'description', 'Kredite shtesë — ' || package_row.credits_included::text || ' kredite',
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
    'custom_package', p_package_id::text
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END
$function$;

REVOKE ALL ON FUNCTION public.admin_issue_custom_package_invoice(uuid) FROM PUBLIC;
