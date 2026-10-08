-- 20261006220000 rebuilt admin_create_custom_package and
-- admin_update_custom_package from the original 20260929130000 copy and so
-- dropped everything six later migrations had added to them: the agreed
-- per-post rate, included credits, the invoice issued for an active package,
-- the link back to the lead, and the audit scope fix. That broke the post and
-- credit proposals as well as the video one.
--
-- These definitions start from the newest version of each function
-- (20261002190000 for create, 20260929150000 for update) and add videos to
-- them, so nothing earlier is lost again. The suggestion is each included
-- amount times its own configured rate.

CREATE OR REPLACE FUNCTION public.admin_custom_package_video_rate()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT custom_package_video_price_cents FROM public.platform_settings;
$function$;

REVOKE ALL ON FUNCTION public.admin_custom_package_video_rate() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_create_custom_package(p_organization_id uuid, p_actor_id uuid, p_actor_email text, p_package jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  created_row public.custom_packages%ROWTYPE;
  posts_included integer := COALESCE((p_package->>'posts_included')::integer, 0);
  videos_included integer := COALESCE((p_package->>'videos_included')::integer, 0);
  credits_included integer := COALESCE((p_package->>'credits_included')::integer, 0);
  rate integer;
  video_rate integer;
  credit_rate integer;
  suggested integer;
  invoice_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=p_organization_id) THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  rate := COALESCE((p_package->>'post_price_cents')::integer, public.admin_custom_package_post_rate());
  video_rate := COALESCE(public.admin_custom_package_video_rate(), 0);
  credit_rate := COALESCE(public.admin_custom_package_credit_rate(), 0);
  suggested := posts_included * rate + videos_included * video_rate + credits_included * credit_rate;
  BEGIN
    INSERT INTO public.custom_packages (organization_id,name,posts_included,videos_included,credits_included,post_price_cents,price_cents,suggested_price_cents,starts_at,ends_at,status,notes,package_request_id)
    VALUES (
      p_organization_id,
      p_package->>'name',
      posts_included,
      videos_included,
      credits_included,
      rate,
      COALESCE((p_package->>'price_cents')::integer,suggested),
      suggested,
      (p_package->>'starts_at')::timestamptz,
      (p_package->>'ends_at')::timestamptz,
      p_package->>'status',
      p_package->>'notes',
      (p_package->>'package_request_id')::uuid
    )
    RETURNING * INTO created_row;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE='P0001';
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR foreign_key_violation THEN RAISE EXCEPTION 'PACKAGE_INVALID' USING ERRCODE='P0001';
  END;
  IF created_row.status='active' THEN invoice_id := public.admin_issue_custom_package_invoice(created_row.id); END IF;
  INSERT INTO public.audit_events (business_id,organization_id,actor_id,action,resource_type,resource_id,result,metadata,revision)
  VALUES (NULL,NULL,p_actor_id,'admin_custom_package.create','custom_package',created_row.id::text,'succeeded',pg_catalog.jsonb_build_object('event_type','admin_custom_package_change','actor_email',p_actor_email,'changes',p_package,'after',pg_catalog.to_jsonb(created_row),'invoice_id',invoice_id),0);
  RETURN pg_catalog.to_jsonb(created_row) || pg_catalog.jsonb_build_object('invoice_id',invoice_id);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_update_custom_package(
  p_package_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_changes jsonb
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
  next_rate integer;
  next_suggested integer;
BEGIN
  SELECT * INTO before_row FROM public.custom_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  next_posts := COALESCE((p_changes->>'posts_included')::integer, before_row.posts_included);
  next_videos := COALESCE((p_changes->>'videos_included')::integer, before_row.videos_included);
  next_rate := COALESCE((p_changes->>'post_price_cents')::integer, before_row.post_price_cents);
  next_suggested := next_posts * next_rate
    + next_videos * COALESCE(public.admin_custom_package_video_rate(), 0);

  BEGIN
    UPDATE public.custom_packages SET
      name = COALESCE(p_changes->>'name', name),
      posts_included = next_posts,
      videos_included = next_videos,
      post_price_cents = next_rate,
      suggested_price_cents = next_suggested,
      price_cents = COALESCE(
        (p_changes->>'price_cents')::integer,
        -- A resize or a new rate moves the price only when the price was the
        -- suggestion; a separately negotiated total is never overwritten.
        CASE
          WHEN before_row.price_cents = before_row.suggested_price_cents THEN next_suggested
          ELSE price_cents
        END
      ),
      starts_at = COALESCE((p_changes->>'starts_at')::timestamptz, starts_at),
      ends_at = COALESCE((p_changes->>'ends_at')::timestamptz, ends_at),
      status = COALESCE(p_changes->>'status', status),
      notes = CASE WHEN p_changes ? 'notes' THEN p_changes->>'notes' ELSE notes END,
      updated_at = pg_catalog.now()
    WHERE id = p_package_id
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE = 'P0001';
    WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
      RAISE EXCEPTION 'PACKAGE_INVALID' USING ERRCODE = 'P0001';
  END;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    before_row.organization_id, before_row.organization_id, p_actor_id, 'admin_custom_package.update',
    'custom_package', p_package_id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_custom_package_change',
      'actor_email', p_actor_email,
      'changes', p_changes,
      'before', pg_catalog.to_jsonb(before_row),
      'after', pg_catalog.to_jsonb(after_row)
    ),
    0
  );
  RETURN pg_catalog.to_jsonb(after_row);
END
$function$;

-- 20261006220000 also left a two-argument suggestion helper behind that nothing
-- calls any more; each function now reads the rates it needs directly.
DROP FUNCTION IF EXISTS public.admin_custom_package_suggestion(integer, integer);

REVOKE ALL ON FUNCTION public.admin_create_custom_package(uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_custom_package(uuid, uuid, text, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_create_custom_package(uuid, uuid, text, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_update_custom_package(uuid, uuid, text, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_custom_package_video_rate() TO service_role;
  END IF;
END
$$;
