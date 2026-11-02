-- The superadmin fills the music library from the admin console instead of an
-- import script. A track is added with its MP3 and licence, and removed by
-- taking it out of the library: the row stays, so a video already made with it
-- keeps its title and credit, and it can be put back.

CREATE OR REPLACE FUNCTION public.admin_music_tracks()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'tracks', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(track) ORDER BY track.active DESC, track.mood, track.title)
      FROM public.music_tracks AS track
    ), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_music_track_path(p_track_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT storage_path FROM public.music_tracks WHERE id = p_track_id;
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_music_track(
  p_actor_id uuid,
  p_actor_email text,
  p_slug text,
  p_title text,
  p_artist text,
  p_mood text,
  p_duration_seconds numeric,
  p_storage_path text,
  p_license text,
  p_credit_text text,
  p_source_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  added public.music_tracks%ROWTYPE;
BEGIN
  INSERT INTO public.music_tracks (slug, title, artist, mood, duration_seconds, storage_path, license, credit_text, source_url)
  VALUES (p_slug, pg_catalog.btrim(p_title), pg_catalog.btrim(p_artist), p_mood, p_duration_seconds, p_storage_path,
    pg_catalog.btrim(p_license), NULLIF(pg_catalog.btrim(p_credit_text), ''), NULLIF(pg_catalog.btrim(p_source_url), ''))
  RETURNING * INTO added;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'music_track', added.id::text,
    NULL,
    pg_catalog.jsonb_build_object('title', added.title, 'artist', added.artist, 'mood', added.mood, 'license', added.license),
    pg_catalog.jsonb_build_object('added', true)
  );
  RETURN pg_catalog.to_jsonb(added);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'MUSIC_TRACK_EXISTS' USING ERRCODE = 'P0001';
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_music_track_active(
  p_track_id uuid,
  p_active boolean,
  p_actor_id uuid,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  previous boolean;
  changed public.music_tracks%ROWTYPE;
BEGIN
  SELECT active INTO previous FROM public.music_tracks WHERE id = p_track_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MUSIC_TRACK_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.music_tracks SET active = p_active WHERE id = p_track_id RETURNING * INTO changed;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'music_track', p_track_id::text,
    pg_catalog.jsonb_build_object('active', previous),
    pg_catalog.jsonb_build_object('active', p_active),
    pg_catalog.jsonb_build_object('title', changed.title)
  );
  RETURN pg_catalog.to_jsonb(changed);
END
$function$;

ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_scope_check;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_scope_check CHECK (
    (organization_id IS NOT NULL AND business_id IS NOT NULL)
    OR (organization_id IS NULL AND business_id IS NULL
        AND resource_type IN (
          'plan',
          'credit_pricing',
          'invoice_settings',
          'platform_settings',
          'package_request',
          'custom_package',
          'organization_invitation',
          'invoice_payment',
          'client_feedback',
          'music_track'
        ))
  );

REVOKE ALL ON FUNCTION public.admin_music_tracks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_music_track_path(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_add_music_track(uuid, text, text, text, text, text, numeric, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_music_track_active(uuid, boolean, uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_music_tracks() TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_music_track_path(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_add_music_track(uuid, text, text, text, text, text, numeric, text, text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_set_music_track_active(uuid, boolean, uuid, text) TO service_role;
  END IF;
END
$$;
