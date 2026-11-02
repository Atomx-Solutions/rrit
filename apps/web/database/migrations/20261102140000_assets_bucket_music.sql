-- The private assets bucket also keeps the music library's MP3s. Nothing a
-- business uploads becomes audio: tracks are added only by the platform.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'video/mp4', 'audio/mpeg']::text[]
 WHERE id = 'assets';
