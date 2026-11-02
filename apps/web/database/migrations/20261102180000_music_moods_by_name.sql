-- Moods are listed by name, so they no longer carry an order of their own.

-- The admin console adds a track with its file, title, artist and mood only;
-- a licence is no longer asked for. Tracks imported with one keep it, and
-- their credit line still goes out with every post that uses them.
ALTER TABLE music_tracks ALTER COLUMN license DROP NOT NULL;

DROP FUNCTION IF EXISTS public.admin_save_music_mood(uuid, text, text, jsonb, integer, boolean);
ALTER TABLE music_moods DROP COLUMN position;

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
    ), '[]'::jsonb),
    'moods', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(mood) || pg_catalog.jsonb_build_object(
          'track_count', (SELECT pg_catalog.count(*) FROM public.music_tracks AS track WHERE track.mood = mood.slug)
        )
        ORDER BY mood.names->>'en', mood.slug
      )
      FROM public.music_moods AS mood
    ), '[]'::jsonb)
  );
$function$;

-- Adds a mood (p_create), or renames one; the slug never changes, so the
-- tracks under it stay. Adding never overwrites a mood of the same name.
CREATE OR REPLACE FUNCTION public.admin_save_music_mood(
  p_actor_id uuid,
  p_actor_email text,
  p_slug text,
  p_names jsonb,
  p_create boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.music_moods%ROWTYPE;
  after_row public.music_moods%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.music_moods WHERE slug = p_slug FOR UPDATE;
  IF p_create AND FOUND THEN
    RAISE EXCEPTION 'MUSIC_MOOD_EXISTS' USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_create AND NOT FOUND THEN
    RAISE EXCEPTION 'MUSIC_MOOD_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.music_moods (slug, names)
  VALUES (p_slug, p_names)
  ON CONFLICT (slug) DO UPDATE SET names = EXCLUDED.names
  RETURNING * INTO after_row;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'music_mood', p_slug,
    CASE WHEN before_row.slug IS NULL THEN NULL ELSE pg_catalog.to_jsonb(before_row) END,
    pg_catalog.to_jsonb(after_row),
    pg_catalog.jsonb_build_object('added', before_row.slug IS NULL)
  );
  RETURN pg_catalog.to_jsonb(after_row);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_save_music_mood(uuid, text, text, jsonb, boolean) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_save_music_mood(uuid, text, text, jsonb, boolean) TO service_role;
  END IF;
END
$$;
