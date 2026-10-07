-- The private assets bucket stores generated MP4 renders as well as photos.
-- Photo uploads are still limited to 2 MiB by the application; the bucket
-- needs a larger ceiling for video, while remaining private.
UPDATE storage.buckets
   SET file_size_limit = 52428800,
       allowed_mime_types = ARRAY['image/jpeg', 'video/mp4']::text[]
 WHERE id = 'assets';
