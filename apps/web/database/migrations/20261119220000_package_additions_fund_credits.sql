-- Posts and videos added to a package, paid or as a gift, fund credits just
-- as a purchase does: each brings the credits the platform settings declare
-- for it. Until now only the credits added outright reached the balance.

ALTER TABLE public.package_additions
  ADD COLUMN IF NOT EXISTS credits_granted integer NOT NULL DEFAULT 0 CHECK (credits_granted >= 0);

-- Credits already granted for the credits-only additions made so far.
UPDATE public.package_additions SET credits_granted = credits WHERE posts = 0 AND videos = 0 AND credits_granted = 0;

CREATE OR REPLACE FUNCTION app.grant_package_addition_credits(p_addition_id uuid, p_credits integer, p_metadata jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  addition public.package_additions%ROWTYPE;
  written integer;
BEGIN
  IF p_credits <= 0 THEN RETURN; END IF;
  SELECT * INTO addition FROM public.package_additions WHERE id = p_addition_id;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.credit_balances (organization_id)
  VALUES (addition.organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO public.credit_ledger
    (organization_id, event_type, credit_delta, reference_type, reference_id, idempotency_key, metadata)
  VALUES (
    addition.organization_id, 'grant', p_credits, 'custom_package', addition.package_id::text,
    'package-addition-credits:' || addition.id::text,
    p_metadata || pg_catalog.jsonb_build_object('reason', 'package_addition', 'addition_id', addition.id, 'kind', addition.kind)
  )
  ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS written = ROW_COUNT;
  IF written = 0 THEN RETURN; END IF;

  UPDATE public.credit_balances
     SET remaining_credits = remaining_credits + p_credits, updated_at = pg_catalog.now()
   WHERE organization_id = addition.organization_id;
END
$function$;
REVOKE ALL ON FUNCTION app.grant_package_addition_credits(uuid, integer, jsonb) FROM PUBLIC;

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
  credits_per_post integer;
  credits_per_video integer;
  granted integer;
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

  -- The same credits a purchase funds: each post and video brings the
  -- credits the platform settings declare for it, plus the credits added.
  SELECT custom_package_credits_per_post INTO credits_per_post FROM public.platform_settings WHERE singleton;
  SELECT video_credits INTO credits_per_video FROM public.credit_pricing WHERE singleton;
  granted := add_posts * COALESCE(credits_per_post, 0) + add_videos * COALESCE(credits_per_video, 0) + add_credits;
  PERFORM app.grant_package_addition_credits(addition_row.id, granted, pg_catalog.jsonb_build_object(
    'posts', add_posts, 'credits_per_post', credits_per_post,
    'videos', add_videos, 'credits_per_video', credits_per_video,
    'credits', add_credits));
  UPDATE public.package_additions SET credits_granted = granted WHERE id = addition_row.id
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

-- Fund the posts and videos already added without their credits, for
-- packages that are still running. Their outright credits were granted then.
DO $$
DECLARE
  addition record;
  per_post integer;
  per_video integer;
  owed integer;
BEGIN
  SELECT custom_package_credits_per_post INTO per_post FROM public.platform_settings WHERE singleton;
  SELECT video_credits INTO per_video FROM public.credit_pricing WHERE singleton;
  FOR addition IN
    SELECT item.* FROM public.package_additions AS item
      JOIN public.custom_packages AS package ON package.id = item.package_id AND package.status = 'active'
     WHERE item.posts + item.videos > 0
       AND NOT EXISTS (SELECT 1 FROM public.credit_ledger AS ledger
                        WHERE ledger.organization_id = item.organization_id
                          AND ledger.idempotency_key = 'package-addition-credits:' || item.id::text)
  LOOP
    owed := addition.posts * COALESCE(per_post, 0) + addition.videos * COALESCE(per_video, 0);
    PERFORM app.grant_package_addition_credits(addition.id, owed, pg_catalog.jsonb_build_object(
      'posts', addition.posts, 'credits_per_post', per_post,
      'videos', addition.videos, 'credits_per_video', per_video, 'backfill', true));
    UPDATE public.package_additions SET credits_granted = addition.credits + owed WHERE id = addition.id;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_add_to_package(uuid, uuid, text, jsonb) TO service_role;
  END IF;
END
$$;
