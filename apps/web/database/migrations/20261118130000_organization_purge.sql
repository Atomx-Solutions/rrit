-- A closed organization's content is removed once the time to reopen it has
-- passed. What proves a payment or an action is kept: the organization row,
-- invoices and their payments, Paddle orders, packages and package requests,
-- the credit ledger, audit events, and posts that were ever published (their
-- publication attempts are append-only). Everything the client made or
-- connected is removed: photos, videos and logos, unpublished posts, plans,
-- planner settings, business facts, social connections, AI history and
-- feedback. The files in Storage are listed for the caller to remove, because
-- they are deleted through the Storage API rather than from its tables.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

-- Organizations whose reopening window has ended and that were not purged yet.
CREATE OR REPLACE FUNCTION public.organizations_due_for_purge(p_limit integer)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT id FROM public.organizations
   WHERE status = 'archived' AND closed_at IS NOT NULL AND purged_at IS NULL
     AND purge_after <= pg_catalog.now()
   ORDER BY purge_after
   LIMIT GREATEST(LEAST(COALESCE(p_limit, 10), 100), 1);
$function$;

CREATE OR REPLACE FUNCTION public.purge_closed_organization(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  organization public.organizations%ROWTYPE;
  has_business boolean;
  storage_paths text[];
  counts jsonb := '{}'::jsonb;
  removed integer;
BEGIN
  SELECT * INTO organization FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  -- Only a closure whose reopening window has ended, and only once.
  IF organization.status <> 'archived' OR organization.closed_at IS NULL
     OR organization.purge_after IS NULL OR organization.purge_after > pg_catalog.now()
     OR organization.purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_DUE_FOR_PURGE' USING ERRCODE = 'P0001';
  END IF;
  has_business := EXISTS (SELECT 1 FROM public.businesses WHERE id = p_organization_id);

  -- Every file under the organization's own folder, and every file its rows
  -- point to wherever it was stored.
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT path), '{}') INTO storage_paths
    FROM (
      SELECT object.name AS path FROM storage.objects AS object
       WHERE object.bucket_id = 'assets' AND object.name LIKE '%-' || p_organization_id::text || '/%'
      UNION SELECT storage_path FROM public.assets WHERE business_id = p_organization_id
      UNION SELECT storage_path FROM public.video_renders WHERE business_id = p_organization_id
      UNION SELECT original_storage_path FROM public.video_renders WHERE business_id = p_organization_id
      UNION SELECT storage_path FROM public.tiktok_video_renders WHERE business_id = p_organization_id
      UNION SELECT contact_sheet_path FROM public.style_snapshots WHERE organization_id = p_organization_id
      UNION SELECT pg_catalog.unnest(photo_paths) FROM public.client_feedback WHERE organization_id = p_organization_id
    ) AS files
   WHERE path IS NOT NULL AND path <> '';

  DELETE FROM public.video_renders WHERE business_id = p_organization_id;
  GET DIAGNOSTICS removed = ROW_COUNT; counts := counts || pg_catalog.jsonb_build_object('video_renders', removed);
  DELETE FROM public.tiktok_video_renders WHERE business_id = p_organization_id;
  DELETE FROM public.image_edits WHERE business_id = p_organization_id;
  GET DIAGNOSTICS removed = ROW_COUNT; counts := counts || pg_catalog.jsonb_build_object('image_edits', removed);

  -- A published post keeps its record; every other post goes, with its
  -- versions, approvals, validations and publication jobs.
  DELETE FROM public.posts AS post
   WHERE post.business_id = p_organization_id
     AND NOT EXISTS (SELECT 1 FROM public.publication_attempts AS attempt WHERE attempt.post_id = post.id);
  GET DIAGNOSTICS removed = ROW_COUNT; counts := counts || pg_catalog.jsonb_build_object('posts', removed);

  DELETE FROM public.assets WHERE business_id = p_organization_id;
  GET DIAGNOSTICS removed = ROW_COUNT; counts := counts || pg_catalog.jsonb_build_object('assets', removed);

  -- A plan a kept, published post still points to stays with it.
  DELETE FROM public.monthly_plans AS plan
   WHERE plan.business_id = p_organization_id
     AND NOT EXISTS (SELECT 1 FROM public.posts AS post
                      WHERE post.monthly_plan_id = plan.id AND post.business_id = p_organization_id);
  DELETE FROM public.monthly_planner_settings WHERE business_id = p_organization_id;
  DELETE FROM public.business_facts WHERE business_id = p_organization_id;
  DELETE FROM public.business_brain_versions WHERE business_id = p_organization_id;
  DELETE FROM public.meta_connections WHERE business_id = p_organization_id;
  DELETE FROM public.instagram_connections WHERE business_id = p_organization_id;
  DELETE FROM public.tiktok_connections WHERE business_id = p_organization_id;
  DELETE FROM public.meta_oauth_states WHERE business_id = p_organization_id;
  DELETE FROM public.instagram_oauth_states WHERE business_id = p_organization_id;
  DELETE FROM public.tiktok_oauth_states WHERE business_id = p_organization_id;
  DELETE FROM public.ai_generations WHERE business_id = p_organization_id;
  DELETE FROM public.ai_daily_usage WHERE business_id = p_organization_id;
  DELETE FROM public.style_snapshots WHERE organization_id = p_organization_id;
  DELETE FROM public.client_feedback WHERE organization_id = p_organization_id;
  counts := counts || pg_catalog.jsonb_build_object('storage_files', pg_catalog.cardinality(storage_paths));

  UPDATE public.organizations SET purged_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE id = p_organization_id;

  -- Recorded in the closer's name: the purge carries out their closure.
  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    CASE WHEN has_business THEN p_organization_id END,
    CASE WHEN has_business THEN p_organization_id END,
    organization.closed_by, 'organization.purged', 'organization', p_organization_id::text, 'succeeded',
    pg_catalog.jsonb_build_object('event_type', 'organization_purge', 'removed', counts,
      'closed_at', organization.closed_at, 'purge_after', organization.purge_after),
    0
  );

  RETURN pg_catalog.jsonb_build_object('storage_paths', pg_catalog.to_jsonb(storage_paths), 'removed', counts);
END $function$;

REVOKE ALL ON FUNCTION public.organizations_due_for_purge(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_closed_organization(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    GRANT EXECUTE ON FUNCTION public.organizations_due_for_purge(integer) TO rrit_worker;
    GRANT EXECUTE ON FUNCTION public.purge_closed_organization(uuid) TO rrit_worker;
  END IF;
END
$$;
