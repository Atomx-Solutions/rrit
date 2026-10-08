-- A package can now include videos beside posts. The suggestion follows the
-- same rule as posts: each included amount times its own platform rate, so a
-- video-only request produces a real suggested price instead of zero.
ALTER TABLE public.custom_packages
  ADD COLUMN IF NOT EXISTS videos_included integer NOT NULL DEFAULT 0
    CHECK (videos_included >= 0 AND videos_included <= 1000);
-- A package may be sold for videos alone, so posts are no longer required to be
-- positive. No rule is added that the package must include posts or videos: a
-- credits-only package already carries zero posts and is a valid agreement.
ALTER TABLE public.custom_packages DROP CONSTRAINT IF EXISTS custom_packages_posts_included_check;
ALTER TABLE public.custom_packages
  ADD CONSTRAINT custom_packages_posts_included_check
  CHECK (posts_included >= 0 AND posts_included <= 1000);
ALTER TABLE public.custom_packages DROP CONSTRAINT IF EXISTS custom_packages_includes_something_check;

DROP FUNCTION IF EXISTS public.admin_custom_package_suggestion(integer);
CREATE FUNCTION public.admin_custom_package_suggestion(
  p_posts_included integer,
  p_videos_included integer DEFAULT 0
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT p_posts_included * (SELECT custom_package_post_price_cents FROM public.platform_settings)
       + COALESCE(p_videos_included, 0) * (SELECT custom_package_video_price_cents FROM public.platform_settings);
$function$;

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
    'packages', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(package)
        ORDER BY package.starts_at DESC, package.id DESC
      )
      FROM public.custom_packages AS package
      WHERE package.organization_id = target_organization_id
    ), '[]'::jsonb)
  );
$function$;

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
  posts_included integer := COALESCE((p_package->>'posts_included')::integer, 0);
  videos_included integer := COALESCE((p_package->>'videos_included')::integer, 0);
  suggested integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  suggested := public.admin_custom_package_suggestion(posts_included, videos_included);

  BEGIN
    INSERT INTO public.custom_packages
      (organization_id, name, posts_included, videos_included, price_cents, suggested_price_cents,
       starts_at, ends_at, status, notes)
    VALUES (
      p_organization_id,
      p_package->>'name',
      posts_included,
      videos_included,
      -- An omitted price accepts the suggestion; a supplied one overrides it.
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

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    p_organization_id, p_organization_id, p_actor_id, 'admin_custom_package.create',
    'custom_package', created_row.id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_custom_package_change',
      'actor_email', p_actor_email,
      'changes', p_package,
      'after', pg_catalog.to_jsonb(created_row)
    ),
    0
  );
  RETURN pg_catalog.to_jsonb(created_row);
END
$function$;

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
  next_suggested integer;
BEGIN
  SELECT * INTO before_row FROM public.custom_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  next_posts := COALESCE((p_changes->>'posts_included')::integer, before_row.posts_included);
  next_videos := COALESCE((p_changes->>'videos_included')::integer, before_row.videos_included);
  -- Resizing the package re-derives the suggestion; leaving the size alone
  -- keeps the suggestion the package was agreed against.
  next_suggested := CASE
    WHEN next_posts = before_row.posts_included AND next_videos = before_row.videos_included
      THEN before_row.suggested_price_cents
    ELSE public.admin_custom_package_suggestion(next_posts, next_videos)
  END;

  BEGIN
    UPDATE public.custom_packages SET
      name = COALESCE(p_changes->>'name', name),
      posts_included = next_posts,
      videos_included = next_videos,
      suggested_price_cents = next_suggested,
      price_cents = COALESCE(
        (p_changes->>'price_cents')::integer,
        -- A resize without an explicit price follows the new suggestion only
        -- when the old price was itself the suggestion, never overwriting a
        -- negotiated figure.
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

REVOKE ALL ON FUNCTION public.admin_custom_package_suggestion(integer, integer) FROM PUBLIC;
