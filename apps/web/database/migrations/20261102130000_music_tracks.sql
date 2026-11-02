-- The platform's own music library: tracks a business can lay under a video
-- instead of music made by the AI. A track belongs to no organization; every
-- business picks from the same library, which only the platform fills.
--
-- The MP3 lives in storage; the row carries its path and what the licence asks
-- for. A track whose licence requires attribution keeps the exact credit line,
-- which is added to the caption of every post that publishes it.

CREATE TABLE music_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  artist text NOT NULL CHECK (length(trim(artist)) BETWEEN 1 AND 120),
  mood text NOT NULL CHECK (mood IN ('calm', 'happy', 'energetic', 'inspiring')),
  duration_seconds numeric(7, 2) NOT NULL CHECK (duration_seconds > 0),
  storage_path text NOT NULL CHECK (length(storage_path) BETWEEN 1 AND 500),
  license text NOT NULL CHECK (length(trim(license)) BETWEEN 1 AND 120),
  credit_text text CHECK (credit_text IS NULL OR length(trim(credit_text)) BETWEEN 1 AND 300),
  source_url text CHECK (source_url IS NULL OR length(source_url) <= 500),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX music_tracks_active_mood ON music_tracks (mood, title) WHERE active;

ALTER TABLE music_tracks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE music_tracks FROM PUBLIC;

-- Every tenant reads the active library; none writes it.
GRANT SELECT ON music_tracks TO app_runtime;
CREATE POLICY music_tracks_runtime_read ON music_tracks FOR SELECT TO app_runtime
  USING (active);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  GRANT SELECT ON music_tracks TO rrit_worker;
  CREATE POLICY music_tracks_worker_read ON music_tracks FOR SELECT TO rrit_worker USING (active);
END
$$;
