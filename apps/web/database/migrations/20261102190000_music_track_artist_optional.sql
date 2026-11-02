-- A track may be added without naming its artist.

ALTER TABLE music_tracks ALTER COLUMN artist DROP NOT NULL;

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
  VALUES (p_slug, pg_catalog.btrim(p_title), NULLIF(pg_catalog.btrim(p_artist), ''), p_mood, p_duration_seconds, p_storage_path,
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
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'MUSIC_MOOD_NOT_FOUND' USING ERRCODE = 'P0001';
END
$function$;
