-- The moods the music library is grouped by become rows the superadmin keeps,
-- instead of a list fixed in code. A mood has a name in each language the app
-- speaks; English is required and stands in for a language left empty.

CREATE TABLE music_moods (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  names jsonb NOT NULL CHECK (
    jsonb_typeof(names) = 'object'
    AND length(trim(COALESCE(names->>'en', ''))) BETWEEN 1 AND 60
  ),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO music_moods (slug, names, position) VALUES
  ('calm', '{"en":"Calm","sq":"E qetë","de":"Ruhig","fr":"Calme","it":"Calma","tr":"Sakin"}', 10),
  ('happy', '{"en":"Happy","sq":"E gëzuar","de":"Fröhlich","fr":"Joyeuse","it":"Allegra","tr":"Neşeli"}', 20),
  ('energetic', '{"en":"Energetic","sq":"Energjike","de":"Energisch","fr":"Énergique","it":"Energica","tr":"Enerjik"}', 30),
  ('inspiring', '{"en":"Inspiring","sq":"Frymëzuese","de":"Inspirierend","fr":"Inspirante","it":"Ispirante","tr":"İlham verici"}', 40);

-- A track's mood is now one of these rows; a mood still holding tracks cannot go.
ALTER TABLE music_tracks DROP CONSTRAINT IF EXISTS music_tracks_mood_check;
ALTER TABLE music_tracks
  ADD CONSTRAINT music_tracks_mood_fkey FOREIGN KEY (mood) REFERENCES music_moods (slug) ON DELETE RESTRICT;

ALTER TABLE music_moods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE music_moods FROM PUBLIC;

-- Every tenant reads the moods; none writes them.
GRANT SELECT ON music_moods TO app_runtime;
CREATE POLICY music_moods_runtime_read ON music_moods FOR SELECT TO app_runtime USING (true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  GRANT SELECT ON music_moods TO rrit_worker;
  CREATE POLICY music_moods_worker_read ON music_moods FOR SELECT TO rrit_worker USING (true);
END
$$;

-- The library as the admin console shows it: every track and every mood, with
-- how many tracks each mood holds.
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
        ORDER BY mood.position, mood.slug
      )
      FROM public.music_moods AS mood
    ), '[]'::jsonb)
  );
$function$;

-- Adds a mood (p_create), or renames and reorders one; the slug never changes,
-- so the tracks under it stay. Adding never overwrites a mood of the same name.
CREATE OR REPLACE FUNCTION public.admin_save_music_mood(
  p_actor_id uuid,
  p_actor_email text,
  p_slug text,
  p_names jsonb,
  p_position integer,
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
  INSERT INTO public.music_moods (slug, names, position)
  VALUES (p_slug, p_names, p_position)
  ON CONFLICT (slug) DO UPDATE SET names = EXCLUDED.names, position = EXCLUDED.position
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

CREATE OR REPLACE FUNCTION public.admin_delete_music_mood(
  p_actor_id uuid,
  p_actor_email text,
  p_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  deleted_row public.music_moods%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.music_tracks WHERE mood = p_slug) THEN
    RAISE EXCEPTION 'MUSIC_MOOD_IN_USE' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.music_moods WHERE slug = p_slug RETURNING * INTO deleted_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MUSIC_MOOD_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'music_mood', p_slug,
    pg_catalog.to_jsonb(deleted_row), NULL,
    pg_catalog.jsonb_build_object('deleted', true)
  );
  RETURN pg_catalog.jsonb_build_object('slug', p_slug);
END
$function$;

-- A track added under a mood that is gone says so instead of a raw key error.
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
  WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'MUSIC_MOOD_NOT_FOUND' USING ERRCODE = 'P0001';
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
          'music_track',
          'music_mood'
        ))
  );

REVOKE ALL ON FUNCTION public.admin_save_music_mood(uuid, text, text, jsonb, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_music_mood(uuid, text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_save_music_mood(uuid, text, text, jsonb, integer, boolean) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_delete_music_mood(uuid, text, text) TO service_role;
  END IF;
END
$$;
