-- Whatever an admin gives a client is either invoiced or recorded as a gift.
--
-- Until now an admin could activate a draft package, or add posts, videos or
-- credits to an active one, and the client received it with no invoice and no
-- trace in the revenue. Now:
--   * activating a package that was never billed issues its invoice;
--   * raising the price of an active, already billed package issues an invoice
--     for the difference;
--   * either can instead be marked as a gift, with a reason. A gift takes no
--     invoice number and no revenue, but is listed in Billing with its own tag.

CREATE TABLE IF NOT EXISTS public.package_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  package_id uuid REFERENCES public.custom_packages(id) ON DELETE SET NULL,
  value_cents integer NOT NULL CHECK (value_cents > 0),
  currency text NOT NULL CHECK (currency IN ('CHF', 'EUR')),
  source_type text NOT NULL CHECK (source_type IN ('custom_package', 'credit_top_up', 'video_purchase')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  actor_id uuid,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS package_gifts_organization_created
  ON public.package_gifts (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS package_gifts_package ON public.package_gifts (package_id);
ALTER TABLE public.package_gifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.package_gifts FROM PUBLIC;

-- What a package (with the add-ons merged into it) is billed under: its own id,
-- the ids of its adjustment invoices, and its Paddle transactions.
CREATE OR REPLACE FUNCTION app.package_invoice_references(p_package_id uuid)
RETURNS TABLE (reference text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH packages AS (
    SELECT id FROM public.custom_packages WHERE id = p_package_id OR parent_package_id = p_package_id
  )
  SELECT id::text FROM packages
  UNION
  SELECT invoice.source_reference
    FROM public.invoices AS invoice
    JOIN packages ON invoice.source_reference LIKE packages.id::text || ':%'
  UNION
  SELECT payment_order.paddle_transaction_id
    FROM public.paddle_payment_orders AS payment_order
    JOIN packages ON packages.id = payment_order.package_id
   WHERE payment_order.paddle_transaction_id IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION app.package_invoice_references(uuid) FROM PUBLIC;

-- True once a package has an invoice or a gift: its first value was accounted for.
CREATE OR REPLACE FUNCTION app.package_accounted(p_package_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM public.invoices
            WHERE kind = 'invoice'
              AND source_reference IN (SELECT reference FROM app.package_invoice_references(p_package_id))
         )
      OR EXISTS (SELECT 1 FROM public.package_gifts WHERE package_id = p_package_id);
$function$;
REVOKE ALL ON FUNCTION app.package_accounted(uuid) FROM PUBLIC;

-- Invoices the difference when an active package is enlarged.
CREATE OR REPLACE FUNCTION app.issue_package_adjustment_invoice(
  p_package_id uuid, p_amount_cents integer, p_description text, p_source_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- public first: app.next_invoice_sequence reads current_schema().
SET search_path = public, pg_catalog
AS $function$
DECLARE
  package_row public.custom_packages%ROWTYPE;
  settings public.invoice_settings%ROWTYPE;
  buyer jsonb;
  issued timestamptz := pg_catalog.now();
  year integer := pg_catalog.date_part('year', issued)::integer;
  seq integer;
  vat integer;
  new_id uuid;
BEGIN
  IF p_amount_cents <= 0 THEN RETURN NULL; END IF;
  SELECT * INTO package_row FROM public.custom_packages WHERE id = p_package_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO settings FROM public.invoice_settings WHERE singleton = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_SETTINGS_MISSING' USING ERRCODE = 'P0001'; END IF;

  SELECT pg_catalog.jsonb_build_object(
           'name', COALESCE(details.legal_name, organization.name),
           'address', COALESCE(details.address, ''), 'city', COALESCE(details.city, ''),
           'country', COALESCE(details.country, ''), 'fiscalNumber', COALESCE(details.fiscal_number, ''))
    INTO buyer
    FROM public.organizations AS organization
    LEFT JOIN public.organization_billing_details AS details ON details.organization_id = organization.id
   WHERE organization.id = package_row.organization_id;

  vat := pg_catalog.round((p_amount_cents::numeric * settings.vat_rate_basis_points) / 10000)::integer;
  seq := app.next_invoice_sequence(year);

  INSERT INTO public.invoices
    (organization_id, number, year, sequence, kind, issued_at, seller, buyer, lines,
     subtotal_cents, vat_rate_basis_points, vat_cents, total_cents, source_type, source_reference)
  VALUES (
    package_row.organization_id,
    settings.number_prefix || '-' || year::text || '-' || pg_catalog.lpad(seq::text, 6, '0'),
    year, seq, 'invoice', issued,
    pg_catalog.jsonb_build_object('name', settings.seller_name, 'address', settings.seller_address,
                                  'fiscalNumber', settings.seller_fiscal_number),
    buyer,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'description', p_description, 'quantity', 1,
      'unitPriceCents', p_amount_cents, 'totalCents', p_amount_cents)),
    p_amount_cents, settings.vat_rate_basis_points, vat, p_amount_cents + vat,
    p_source_type, p_package_id::text || ':' || pg_catalog.gen_random_uuid()::text
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END
$function$;
REVOKE ALL ON FUNCTION app.issue_package_adjustment_invoice(uuid, integer, text, text) FROM PUBLIC;

-- What changed, in words, for the adjustment invoice or the gift.
CREATE OR REPLACE FUNCTION app.package_change_description(
  p_before public.custom_packages, p_after public.custom_packages
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT p_after.name || ' — ' || COALESCE(NULLIF(pg_catalog.concat_ws(', ',
    CASE WHEN p_after.posts_included > COALESCE(p_before.posts_included, 0)
         THEN '+' || (p_after.posts_included - COALESCE(p_before.posts_included, 0))::text || ' posts' END,
    CASE WHEN p_after.videos_included > COALESCE(p_before.videos_included, 0)
         THEN '+' || (p_after.videos_included - COALESCE(p_before.videos_included, 0))::text || ' videos' END,
    CASE WHEN p_after.credits_included > COALESCE(p_before.credits_included, 0)
         THEN '+' || (p_after.credits_included - COALESCE(p_before.credits_included, 0))::text || ' credits' END
  ), ''), 'package update');
$function$;

-- Credits alone are a credit top-up; anything with posts or videos is a package.
CREATE OR REPLACE FUNCTION app.package_change_source(
  p_before public.custom_packages, p_after public.custom_packages
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT CASE
    WHEN p_after.posts_included <= COALESCE(p_before.posts_included, 0)
     AND p_after.videos_included <= COALESCE(p_before.videos_included, 0) THEN 'credit_top_up'
    WHEN p_after.posts_included <= COALESCE(p_before.posts_included, 0) THEN 'video_purchase'
    ELSE 'custom_package'
  END;
$function$;

CREATE OR REPLACE FUNCTION app.record_package_gift(
  p_package public.custom_packages, p_value_cents integer, p_description text, p_source_type text,
  p_reason text, p_actor_id uuid, p_actor_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  new_id uuid;
BEGIN
  IF p_value_cents <= 0 THEN RETURN NULL; END IF;
  INSERT INTO public.package_gifts
    (organization_id, package_id, value_cents, currency, source_type, description, reason, actor_id, actor_email)
  VALUES
    (p_package.organization_id, p_package.id, p_value_cents, p_package.currency, p_source_type,
     p_description, btrim(p_reason), p_actor_id, p_actor_email)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$function$;
REVOKE ALL ON FUNCTION app.record_package_gift(public.custom_packages, integer, text, text, text, uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_create_custom_package(
  p_organization_id uuid, p_actor_id uuid, p_actor_email text, p_package jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  created_row public.custom_packages%ROWTYPE;
  posts_included integer := COALESCE((p_package->>'posts_included')::integer, 0);
  videos_included integer := COALESCE((p_package->>'videos_included')::integer, 0);
  credits_included integer := COALESCE((p_package->>'credits_included')::integer, 0);
  is_gift boolean := COALESCE((p_package->>'gift')::boolean, false);
  gift_reason text := NULLIF(btrim(COALESCE(p_package->>'gift_reason', '')), '');
  rate integer;
  video_rate integer;
  credit_rate integer;
  suggested integer;
  selected_currency text;
  invoice_id uuid;
  gift_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF is_gift AND gift_reason IS NULL THEN
    RAISE EXCEPTION 'GIFT_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  SELECT CASE WHEN package_currency = 'EUR' THEN 'EUR' ELSE 'CHF' END
    INTO selected_currency FROM public.platform_settings WHERE singleton;
  rate := COALESCE((p_package->>'post_price_cents')::integer, public.admin_custom_package_post_rate());
  video_rate := COALESCE((p_package->>'video_price_cents')::integer, public.admin_custom_package_video_rate(), 0);
  credit_rate := COALESCE(public.admin_custom_package_credit_rate(), 0);
  suggested := posts_included * rate + videos_included * video_rate + credits_included * credit_rate;

  BEGIN
    INSERT INTO public.custom_packages
      (organization_id, name, posts_included, videos_included, credits_included,
       post_price_cents, video_price_cents, price_cents, suggested_price_cents,
       currency, starts_at, ends_at, status, notes, package_request_id)
    VALUES
      (p_organization_id, p_package->>'name', posts_included, videos_included, credits_included,
       rate, video_rate, COALESCE((p_package->>'price_cents')::integer, suggested), suggested,
       COALESCE(selected_currency, 'CHF'), (p_package->>'starts_at')::timestamptz,
       (p_package->>'ends_at')::timestamptz, p_package->>'status', p_package->>'notes',
       (p_package->>'package_request_id')::uuid)
    RETURNING * INTO created_row;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE = 'P0001';
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR foreign_key_violation
      THEN RAISE EXCEPTION 'PACKAGE_INVALID' USING ERRCODE = 'P0001';
  END;

  IF created_row.status = 'active' THEN
    IF is_gift THEN
      gift_id := app.record_package_gift(created_row, created_row.price_cents,
        app.package_change_description(NULL, created_row), app.package_change_source(NULL, created_row),
        gift_reason, p_actor_id, p_actor_email);
    ELSE
      invoice_id := public.admin_issue_custom_package_invoice(created_row.id);
    END IF;
  END IF;
  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES
    (NULL, NULL, p_actor_id, 'admin_custom_package.create', 'custom_package', created_row.id::text,
     'succeeded', pg_catalog.jsonb_build_object('event_type', 'admin_custom_package_change',
     'actor_email', p_actor_email, 'changes', p_package, 'after', pg_catalog.to_jsonb(created_row),
     'invoice_id', invoice_id, 'gift_id', gift_id), 0);
  RETURN pg_catalog.to_jsonb(created_row)
    || pg_catalog.jsonb_build_object('invoice_id', invoice_id, 'gift_id', gift_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_custom_package(
  p_package_id uuid, p_actor_id uuid, p_actor_email text, p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.custom_packages%ROWTYPE;
  after_row public.custom_packages%ROWTYPE;
  next_posts integer;
  next_videos integer;
  next_credits integer;
  credit_top_up integer;
  next_post_rate integer;
  next_video_rate integer;
  credit_rate integer;
  previous_suggested integer;
  next_suggested integer;
  selected_currency text;
  is_gift boolean := COALESCE((p_changes->>'gift')::boolean, false);
  gift_reason text := NULLIF(btrim(COALESCE(p_changes->>'gift_reason', '')), '');
  was_accounted boolean;
  added_value integer := 0;
  invoice_id uuid;
  gift_id uuid;
BEGIN
  SELECT * INTO before_row FROM public.custom_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF is_gift AND gift_reason IS NULL THEN
    RAISE EXCEPTION 'GIFT_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  was_accounted := app.package_accounted(p_package_id);
  SELECT CASE WHEN package_currency = 'EUR' THEN 'EUR' ELSE 'CHF' END
    INTO selected_currency FROM public.platform_settings WHERE singleton;
  next_posts := COALESCE((p_changes->>'posts_included')::integer, before_row.posts_included);
  next_videos := COALESCE((p_changes->>'videos_included')::integer, before_row.videos_included);
  credit_top_up := COALESCE((p_changes->>'credit_top_up')::integer, 0);
  next_credits := COALESCE((p_changes->>'credits_included')::integer, before_row.credits_included)
    + credit_top_up;
  next_post_rate := COALESCE((p_changes->>'post_price_cents')::integer, before_row.post_price_cents);
  next_video_rate := COALESCE((p_changes->>'video_price_cents')::integer, before_row.video_price_cents);
  SELECT COALESCE(credit_price_cents, 0) INTO credit_rate FROM public.credit_pricing WHERE singleton;
  previous_suggested := before_row.posts_included * before_row.post_price_cents
    + before_row.videos_included * before_row.video_price_cents
    + before_row.credits_included * COALESCE(credit_rate, 0);
  next_suggested := next_posts * next_post_rate + next_videos * next_video_rate
    + next_credits * COALESCE(credit_rate, 0);

  BEGIN
    UPDATE public.custom_packages SET
      name = COALESCE(p_changes->>'name', name),
      posts_included = next_posts,
      videos_included = next_videos,
      credits_included = next_credits,
      post_price_cents = next_post_rate,
      video_price_cents = next_video_rate,
      suggested_price_cents = next_suggested,
      price_cents = COALESCE((p_changes->>'price_cents')::integer,
        CASE WHEN before_row.price_cents = previous_suggested THEN next_suggested ELSE price_cents END),
      currency = COALESCE(selected_currency, 'CHF'),
      starts_at = COALESCE((p_changes->>'starts_at')::timestamptz, starts_at),
      ends_at = COALESCE((p_changes->>'ends_at')::timestamptz, ends_at),
      status = COALESCE(p_changes->>'status', status),
      notes = CASE WHEN p_changes ? 'notes' THEN p_changes->>'notes' ELSE notes END,
      updated_at = pg_catalog.now()
    WHERE id = p_package_id
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE = 'P0001';
    WHEN check_violation OR not_null_violation OR invalid_text_representation
      THEN RAISE EXCEPTION 'PACKAGE_INVALID' USING ERRCODE = 'P0001';
  END;

  IF before_row.status = 'active'
     AND after_row.status = 'active'
     AND after_row.credits_included > before_row.credits_included THEN
    PERFORM app.grant_admin_package_credit_topup(
      after_row.id,
      after_row.credits_included - before_row.credits_included,
      after_row.credits_included
    );
  END IF;

  -- Whatever the client now receives on top of what was already accounted for
  -- is invoiced, or recorded as a gift.
  IF after_row.status = 'active' THEN
    -- A package that is switched on for the first time is accounted for in
    -- full; one that was already running only for what is added to it.
    IF NOT was_accounted AND before_row.status <> 'active' THEN
      IF is_gift THEN
        gift_id := app.record_package_gift(after_row, after_row.price_cents,
          app.package_change_description(NULL, after_row), app.package_change_source(NULL, after_row),
          gift_reason, p_actor_id, p_actor_email);
      ELSE
        invoice_id := public.admin_issue_custom_package_invoice(after_row.id);
      END IF;
    ELSE
      added_value := after_row.price_cents - before_row.price_cents;
      IF added_value > 0 AND is_gift THEN
        gift_id := app.record_package_gift(after_row, added_value,
          app.package_change_description(before_row, after_row), app.package_change_source(before_row, after_row),
          gift_reason, p_actor_id, p_actor_email);
      ELSIF added_value > 0 THEN
        invoice_id := app.issue_package_adjustment_invoice(after_row.id, added_value,
          app.package_change_description(before_row, after_row), app.package_change_source(before_row, after_row));
      END IF;
    END IF;
  END IF;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES
    (before_row.organization_id, before_row.organization_id, p_actor_id, 'admin_custom_package.update',
     'custom_package', p_package_id::text, 'succeeded', pg_catalog.jsonb_build_object(
     'event_type', 'admin_custom_package_change', 'actor_email', p_actor_email,
     'changes', p_changes, 'before', pg_catalog.to_jsonb(before_row), 'after', pg_catalog.to_jsonb(after_row),
     'invoice_id', invoice_id, 'gift_id', gift_id), 0);
  RETURN pg_catalog.to_jsonb(after_row)
    || pg_catalog.jsonb_build_object('invoice_id', invoice_id, 'gift_id', gift_id);
END
$function$;

-- The billing list shows gifts beside invoices, each with its own tag.
-- Gifts never enter the summary: they are not revenue.
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
  SELECT gift.id, NULL, 'gift', 'gift', gift.created_at, gift.organization_id, organization.name,
         gift.value_cents, gift.value_cents, 0, gift.source_type, gift.currency,
         jsonb_build_array(jsonb_build_object('description', gift.description, 'quantity', 1,
                                              'unitPriceCents', gift.value_cents, 'totalCents', gift.value_cents)),
         NULL, NULL, NULL, NULL, NULL, false,
         gift.reason, gift.actor_email, 0
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

-- The billing tiles count a credit note with the invoice it cancels, whatever
-- the type or source filter: a cancelled invoice is no revenue. The source of a
-- credit note is its original invoice's.
CREATE OR REPLACE FUNCTION public.admin_billing_summary_by_currency(
  p_org_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_source_type text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH rows AS (
    SELECT i.currency, (i.issued_at AT TIME ZONE public.admin_reporting_timezone())::date AS rate_date,
           i.kind, i.total_cents, i.subtotal_cents, i.vat_cents,
           CASE
             WHEN payment.invoice_id IS NULL THEN NULL
             WHEN EXISTS (SELECT 1 FROM public.invoices AS credit WHERE credit.credited_invoice_id = i.id) THEN 'credited'
             WHEN payment.status = 'paid' THEN 'paid'
             WHEN payment.due_at <= pg_catalog.now() THEN 'overdue'
             ELSE 'unpaid'
           END AS payment_status
      FROM public.invoices AS i
      LEFT JOIN public.invoices AS original ON original.id = i.credited_invoice_id
      LEFT JOIN public.invoice_payments AS payment ON payment.invoice_id = i.id
     WHERE (p_org_id IS NULL OR i.organization_id = p_org_id)
       AND (p_source_type IS NULL OR COALESCE(original.source_type, i.source_type) = p_source_type)
       AND (p_from IS NULL OR i.issued_at >= p_from)
       AND (p_to IS NULL OR i.issued_at < p_to)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'currency', currency,
    'rate_date', rate_date,
    'gross_revenue_cents', gross,
    'net_revenue_cents', net,
    'vat_cents', vat,
    'outstanding_cents', outstanding,
    'overdue_cents', overdue
  )), '[]'::jsonb)
  FROM (
    SELECT currency, rate_date,
           COALESCE(pg_catalog.sum(total_cents), 0)::bigint AS gross,
           COALESCE(pg_catalog.sum(subtotal_cents), 0)::bigint AS net,
           COALESCE(pg_catalog.sum(vat_cents), 0)::bigint AS vat,
           COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE payment_status IN ('unpaid', 'overdue')), 0)::bigint AS outstanding,
           COALESCE(pg_catalog.sum(total_cents) FILTER (WHERE payment_status = 'overdue'), 0)::bigint AS overdue
      FROM rows
     GROUP BY currency, rate_date
  ) AS grouped;
$function$;

-- A won lead's value now also includes the adjustment invoices of its package
-- and the add-ons merged into it.
CREATE OR REPLACE FUNCTION public.admin_package_request_conversion_value_by_currency(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  WITH won_packages AS (
    SELECT package.id, package.price_cents, package.currency, package.created_at
      FROM public.package_requests AS lead
      JOIN public.custom_packages AS package ON package.package_request_id = lead.id
     WHERE lead.status = 'won'
       AND lead.created_at >= p_from AND lead.created_at < p_to
  ), invoiced AS (
    SELECT package.id AS package_id, entry.currency, entry.subtotal_cents,
           (entry.issued_at AT TIME ZONE public.admin_reporting_timezone())::date AS rate_date
      FROM won_packages AS package
      CROSS JOIN LATERAL app.package_invoice_references(package.id) AS reference
      JOIN public.invoices AS invoice
        ON invoice.source_reference = reference.reference
       AND invoice.kind = 'invoice'
      JOIN public.invoices AS entry
        ON entry.id = invoice.id OR entry.credited_invoice_id = invoice.id
  ), valued AS (
    SELECT currency, rate_date, subtotal_cents AS cents FROM invoiced
    UNION ALL
    -- A package with no invoice and no gift yet is worth its agreed price.
    SELECT COALESCE(package.currency, settings.package_currency),
           (package.created_at AT TIME ZONE public.admin_reporting_timezone())::date,
           package.price_cents
      FROM won_packages AS package
      CROSS JOIN public.platform_settings AS settings
     WHERE settings.singleton
       AND NOT EXISTS (SELECT 1 FROM invoiced WHERE invoiced.package_id = package.id)
       AND NOT EXISTS (SELECT 1 FROM public.package_gifts AS gift WHERE gift.package_id = package.id)
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'currency', currency, 'rate_date', rate_date, 'cents', cents
  )), '[]'::jsonb)
  FROM (
    SELECT currency, rate_date, pg_catalog.sum(cents)::bigint AS cents
      FROM valued
     GROUP BY currency, rate_date
  ) AS grouped;
$function$;

-- Billed value of every package in force, for the overview's recurring revenue.
CREATE OR REPLACE FUNCTION public.admin_packages_in_force_billing()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'package_id', package.id,
    'starts_at', package.starts_at,
    'ends_at', package.ends_at,
    'currency', entry.currency,
    'rate_date', (entry.issued_at AT TIME ZONE public.admin_reporting_timezone())::date,
    'billed_cents', entry.subtotal_cents
  )) FILTER (WHERE entry.id IS NOT NULL), '[]'::jsonb)
  FROM public.custom_packages AS package
  CROSS JOIN LATERAL app.package_invoice_references(package.id) AS reference
  JOIN public.invoices AS invoice
    ON invoice.source_reference = reference.reference AND invoice.kind = 'invoice'
  JOIN public.invoices AS entry
    ON entry.id = invoice.id OR entry.credited_invoice_id = invoice.id
  WHERE package.status = 'active'
    AND package.starts_at <= pg_catalog.now()
    AND package.ends_at > pg_catalog.now();
$function$;
REVOKE ALL ON FUNCTION public.admin_packages_in_force_billing() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_packages_in_force_billing() TO service_role;
  END IF;
END
$$;
