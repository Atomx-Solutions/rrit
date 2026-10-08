-- Meta fetches a Reel or a page video from a URL of ours, and keeps fetching
-- while it transcodes, so the publishing route serves a render with no tenant
-- in scope. Row level security would otherwise hide every row from that read.
--
-- The same shape as app.read_signed_asset_location: the short-lived signature
-- in the request is what authorises the read, so this grants no listing and no
-- lookup by anything but a known render id, and only a finished render with a
-- stored file is readable at all.
CREATE OR REPLACE FUNCTION app.read_signed_video_location(render_id uuid)
RETURNS TABLE(storage_path text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.storage_path
  FROM public.video_renders AS r
  WHERE r.id = $1 AND r.status = 'ready' AND r.storage_path IS NOT NULL
$$;

REVOKE ALL ON FUNCTION app.read_signed_video_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_signed_video_location(uuid) TO app_runtime;
