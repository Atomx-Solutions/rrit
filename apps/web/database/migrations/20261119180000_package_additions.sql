-- Posts, videos and credits are added to the running package through one
-- action, paid or as a gift, instead of by editing the package's quantities.
-- Each addition is kept with the document it produced, so the package can show
-- what was bought at first, what was added and what was given.

CREATE TABLE IF NOT EXISTS public.package_additions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.custom_packages(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('paid', 'gift')),
  posts integer NOT NULL DEFAULT 0 CHECK (posts >= 0),
  videos integer NOT NULL DEFAULT 0 CHECK (videos >= 0),
  credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0),
  value_cents integer NOT NULL CHECK (value_cents >= 0),
  currency text NOT NULL CHECK (currency IN ('CHF', 'EUR')),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  gift_id uuid REFERENCES public.package_gifts(id) ON DELETE RESTRICT,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (posts + videos + credits > 0),
  CHECK ((kind = 'paid' AND gift_id IS NULL) OR (kind = 'gift' AND invoice_id IS NULL))
);
CREATE INDEX IF NOT EXISTS package_additions_package_created
  ON public.package_additions (package_id, created_at DESC);
ALTER TABLE public.package_additions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.package_additions FROM PUBLIC;

-- The additions made earlier through the edit form: their documents name what
-- was added ("HI — +100 credits").
CREATE OR REPLACE FUNCTION app.addition_count(p_description text, p_unit text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE((pg_catalog.regexp_match(p_description, '\+(\d+) ' || p_unit))[1]::integer, 0);
$function$;

INSERT INTO public.package_additions
  (package_id, organization_id, kind, posts, videos, credits, value_cents, currency, invoice_id, created_at)
SELECT package.id, invoice.organization_id, 'paid',
       app.addition_count(invoice.lines->0->>'description', 'posts'),
       app.addition_count(invoice.lines->0->>'description', 'videos'),
       app.addition_count(invoice.lines->0->>'description', 'credits'),
       invoice.subtotal_cents, invoice.currency, invoice.id, invoice.issued_at
  FROM public.invoices AS invoice
  JOIN public.custom_packages AS package ON invoice.source_reference LIKE package.id::text || ':%'
 WHERE invoice.kind = 'invoice'
   AND NOT EXISTS (SELECT 1 FROM public.package_additions AS addition WHERE addition.invoice_id = invoice.id)
   AND app.addition_count(invoice.lines->0->>'description', 'posts')
     + app.addition_count(invoice.lines->0->>'description', 'videos')
     + app.addition_count(invoice.lines->0->>'description', 'credits') > 0;

INSERT INTO public.package_additions
  (package_id, organization_id, kind, posts, videos, credits, value_cents, currency, gift_id, actor_email, created_at)
SELECT gift.package_id, gift.organization_id, 'gift',
       app.addition_count(gift.description, 'posts'),
       app.addition_count(gift.description, 'videos'),
       app.addition_count(gift.description, 'credits'),
       gift.value_cents, gift.currency, gift.id, gift.actor_email, gift.created_at
  FROM public.package_gifts AS gift
 WHERE gift.package_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.package_additions AS addition WHERE addition.gift_id = gift.id)
   AND app.addition_count(gift.description, 'posts')
     + app.addition_count(gift.description, 'videos')
     + app.addition_count(gift.description, 'credits') > 0;

-- Adds to the active package, paid (an invoice for the price) or as a gift
-- (a gift document, nothing to pay). The package's agreed price stays what was
-- bought at first; each addition carries its own value.
CREATE OR REPLACE FUNCTION public.admin_add_to_package(
  p_package_id uuid, p_actor_id uuid, p_actor_email text, p_addition jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.custom_packages%ROWTYPE;
  after_row public.custom_packages%ROWTYPE;
  add_posts integer := GREATEST(COALESCE((p_addition->>'posts')::integer, 0), 0);
  add_videos integer := GREATEST(COALESCE((p_addition->>'videos')::integer, 0), 0);
  add_credits integer := GREATEST(COALESCE((p_addition->>'credits')::integer, 0), 0);
  is_gift boolean := COALESCE((p_addition->>'gift')::boolean, false);
  reason text := NULLIF(pg_catalog.btrim(COALESCE(p_addition->>'reason', '')), '');
  credit_rate integer;
  value integer;
  description text;
  source text;
  new_invoice uuid;
  new_gift uuid;
  addition_row public.package_additions%ROWTYPE;
  document_number text;
BEGIN
  SELECT * INTO before_row FROM public.custom_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF before_row.status <> 'active' THEN RAISE EXCEPTION 'PACKAGE_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF add_posts + add_videos + add_credits = 0 THEN RAISE EXCEPTION 'ADDITION_EMPTY' USING ERRCODE = 'P0001'; END IF;
  IF is_gift AND reason IS NULL THEN RAISE EXCEPTION 'GIFT_REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(credit_price_cents, 0) INTO credit_rate FROM public.credit_pricing WHERE singleton;
  value := COALESCE((p_addition->>'price_cents')::integer,
    add_posts * before_row.post_price_cents + add_videos * before_row.video_price_cents
      + add_credits * COALESCE(credit_rate, 0));
  IF value IS NULL OR value <= 0 THEN RAISE EXCEPTION 'ADDITION_PRICE_INVALID' USING ERRCODE = 'P0001'; END IF;

  UPDATE public.custom_packages SET
    posts_included = posts_included + add_posts,
    videos_included = videos_included + add_videos,
    credits_included = credits_included + add_credits,
    updated_at = pg_catalog.now()
  WHERE id = p_package_id
  RETURNING * INTO after_row;

  IF add_credits > 0 THEN
    PERFORM app.grant_admin_package_credit_topup(after_row.id, add_credits, after_row.credits_included);
  END IF;

  description := app.package_change_description(before_row, after_row);
  source := app.package_change_source(before_row, after_row);
  IF is_gift THEN
    new_gift := app.record_package_gift(after_row, value, description, source, reason, p_actor_id, p_actor_email);
    SELECT number INTO document_number FROM public.package_gifts WHERE id = new_gift;
  ELSE
    new_invoice := app.issue_package_adjustment_invoice(after_row.id, value, description, source);
    SELECT number INTO document_number FROM public.invoices WHERE id = new_invoice;
  END IF;

  INSERT INTO public.package_additions
    (package_id, organization_id, kind, posts, videos, credits, value_cents, currency,
     invoice_id, gift_id, actor_email)
  VALUES
    (after_row.id, after_row.organization_id, CASE WHEN is_gift THEN 'gift' ELSE 'paid' END,
     add_posts, add_videos, add_credits, value, after_row.currency, new_invoice, new_gift, p_actor_email)
  RETURNING * INTO addition_row;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES
    (after_row.organization_id, after_row.organization_id, p_actor_id, 'admin_custom_package.addition',
     'custom_package', after_row.id::text, 'succeeded', pg_catalog.jsonb_build_object(
       'event_type', 'admin_custom_package_change', 'actor_email', p_actor_email,
       'addition', pg_catalog.to_jsonb(addition_row), 'reason', reason,
       'before', pg_catalog.to_jsonb(before_row), 'after', pg_catalog.to_jsonb(after_row),
       'invoice_id', new_invoice, 'gift_id', new_gift), 0);

  RETURN pg_catalog.to_jsonb(addition_row) || pg_catalog.jsonb_build_object('number', document_number);
END
$function$;
REVOKE ALL ON FUNCTION public.admin_add_to_package(uuid, uuid, text, jsonb) FROM PUBLIC;

-- The packages tab: each package with its usage, what was bought at first,
-- the additions with their documents, and the organization's credit balance.
CREATE OR REPLACE FUNCTION public.admin_organization_packages(target_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'post_price_cents', (SELECT custom_package_post_price_cents FROM public.platform_settings),
    'video_price_cents', (SELECT custom_package_video_price_cents FROM public.platform_settings),
    'credit_price_cents', (SELECT credit_price_cents FROM public.credit_pricing WHERE singleton = true),
    'credits_remaining', COALESCE((SELECT remaining_credits FROM public.credit_balances
                                    WHERE organization_id = target_organization_id), 0),
    'packages', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(package) || pg_catalog.jsonb_build_object(
          'used_posts', usage.used_posts,
          'remaining_posts', GREATEST(0, package.posts_included - usage.used_posts),
          'used_videos', usage.used_videos,
          'remaining_videos', GREATEST(0, package.videos_included - usage.used_videos),
          'remaining_days', CASE
            WHEN package.status = 'active'
              AND package.starts_at <= pg_catalog.now()
              AND package.ends_at > pg_catalog.now()
            THEN GREATEST(0, pg_catalog.ceil(EXTRACT(epoch FROM (package.ends_at - pg_catalog.now())) / 86400))::integer
            ELSE 0
          END,
          'additions', additions.list
        )
        ORDER BY package.starts_at DESC, package.id DESC
      )
      FROM public.custom_packages AS package
      CROSS JOIN LATERAL (
        SELECT
          (SELECT pg_catalog.count(*)::integer
             FROM public.posts
            WHERE business_id = package.organization_id
              AND created_at >= package.starts_at
              AND created_at < package.ends_at) AS used_posts,
          (SELECT pg_catalog.count(*)::integer
             FROM public.video_renders
            WHERE business_id = package.organization_id
              AND created_at >= package.starts_at
              AND created_at < package.ends_at) AS used_videos
      ) AS usage
      CROSS JOIN LATERAL (
        SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'id', addition.id, 'kind', addition.kind,
                 'posts', addition.posts, 'videos', addition.videos, 'credits', addition.credits,
                 'value_cents', addition.value_cents, 'currency', addition.currency,
                 'created_at', addition.created_at, 'actor_email', addition.actor_email,
                 'number', COALESCE(invoice.number, gift.number),
                 'reason', gift.reason,
                 'payment_status', CASE
                   WHEN addition.kind = 'gift' THEN 'gift'
                   WHEN payment.status = 'paid' THEN 'paid'
                   WHEN payment.due_at <= pg_catalog.now() THEN 'overdue'
                   ELSE 'unpaid'
                 END
               ) ORDER BY addition.created_at DESC), '[]'::jsonb) AS list
          FROM public.package_additions AS addition
          LEFT JOIN public.invoices AS invoice ON invoice.id = addition.invoice_id
          LEFT JOIN public.invoice_payments AS payment ON payment.invoice_id = addition.invoice_id
          LEFT JOIN public.package_gifts AS gift ON gift.id = addition.gift_id
         WHERE addition.package_id = package.id
      ) AS additions
      WHERE package.organization_id = target_organization_id
    ), '[]'::jsonb)
  );
$function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_add_to_package(uuid, uuid, text, jsonb) TO service_role;
  END IF;
END
$$;
