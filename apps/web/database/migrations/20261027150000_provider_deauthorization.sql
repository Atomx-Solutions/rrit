-- Meta calls these when a person removes Framic from their Facebook or
-- Instagram account, or asks for their data to be deleted. The request is
-- authenticated by Meta's signed_request in the HTTP handler and carries no
-- tenant context, so the work runs in narrow SECURITY DEFINER functions.

-- Instagram Login identifies a deauthorizing person by the app-scoped id,
-- which differs from the professional account id used for publishing.
ALTER TABLE public.instagram_connections ADD COLUMN instagram_scoped_id text;

CREATE TABLE public.provider_data_deletions (
  confirmation_code text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('facebook', 'instagram')),
  connections_removed integer NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_data_deletions ENABLE ROW LEVEL SECURITY;

-- Removes (p_delete) or revokes the connections of one provider account.
-- Deleting also drops the posts imported from it and cancels its pending
-- automatic publications; scheduled posts stay in the calendar as manual.
CREATE OR REPLACE FUNCTION app.remove_provider_account(
  p_provider text,
  p_account_id text,
  p_delete boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  affected integer := 0;
  connection record;
  cancelled uuid[];
BEGIN
  IF p_provider = 'facebook' THEN
    FOR connection IN
      SELECT id, business_id, page_id, instagram_id
        FROM public.meta_connections
       WHERE facebook_user_id = p_account_id
       FOR UPDATE
    LOOP
      affected := affected + 1;
      IF NOT p_delete THEN
        UPDATE public.meta_connections SET status = 'revoked', updated_at = now() WHERE id = connection.id;
        CONTINUE;
      END IF;
      WITH jobs AS (
        UPDATE public.publication_jobs SET status = 'cancelled', updated_at = now()
         WHERE business_id = connection.business_id AND status = 'pending' AND target_page_id IS NOT NULL
        RETURNING post_id
      )
      SELECT array_agg(post_id) INTO cancelled FROM jobs;
      UPDATE public.posts
         SET payload = jsonb_set(payload, '{publicationMode}', '"manual"'), updated_at = now()
       WHERE business_id = connection.business_id AND id = ANY(COALESCE(cancelled, '{}'));
      DELETE FROM public.social_posts
       WHERE business_id = connection.business_id
         AND source_account_id IN (connection.page_id, connection.instagram_id)
         AND NOT EXISTS (
           SELECT 1 FROM public.instagram_connections ic
            WHERE ic.business_id = connection.business_id AND ic.instagram_user_id = social_posts.source_account_id
         );
      DELETE FROM public.meta_connections WHERE id = connection.id;
    END LOOP;
  ELSIF p_provider = 'instagram' THEN
    FOR connection IN
      SELECT id, business_id, instagram_user_id
        FROM public.instagram_connections
       WHERE instagram_scoped_id = p_account_id OR instagram_user_id = p_account_id
       FOR UPDATE
    LOOP
      affected := affected + 1;
      IF NOT p_delete THEN
        UPDATE public.instagram_connections SET status = 'revoked', updated_at = now() WHERE id = connection.id;
        CONTINUE;
      END IF;
      WITH jobs AS (
        UPDATE public.publication_jobs SET status = 'cancelled', updated_at = now()
         WHERE business_id = connection.business_id AND status = 'pending'
           AND target_page_id IS NULL AND target_instagram_id = connection.instagram_user_id
        RETURNING post_id
      )
      SELECT array_agg(post_id) INTO cancelled FROM jobs;
      UPDATE public.posts
         SET payload = jsonb_set(payload, '{publicationMode}', '"manual"'), updated_at = now()
       WHERE business_id = connection.business_id AND id = ANY(COALESCE(cancelled, '{}'));
      DELETE FROM public.social_posts
       WHERE business_id = connection.business_id AND channel = 'Instagram'
         AND source_account_id = connection.instagram_user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.meta_connections mc
            WHERE mc.business_id = connection.business_id AND mc.instagram_id = connection.instagram_user_id
         );
      DELETE FROM public.instagram_connections WHERE id = connection.id;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unknown provider: %', p_provider;
  END IF;
  RETURN affected;
END;
$function$;

CREATE OR REPLACE FUNCTION app.record_provider_data_deletion(
  p_confirmation_code text,
  p_provider text,
  p_connections_removed integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  INSERT INTO public.provider_data_deletions (confirmation_code, provider, connections_removed)
  VALUES (p_confirmation_code, p_provider, p_connections_removed);
$function$;

CREATE OR REPLACE FUNCTION app.provider_data_deletion_status(p_confirmation_code text)
RETURNS TABLE (provider text, completed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT provider, completed_at FROM public.provider_data_deletions WHERE confirmation_code = p_confirmation_code;
$function$;

REVOKE ALL ON FUNCTION app.remove_provider_account(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_provider_data_deletion(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.provider_data_deletion_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.remove_provider_account(text, text, boolean) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.record_provider_data_deletion(text, text, integer) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.provider_data_deletion_status(text) TO app_runtime;
