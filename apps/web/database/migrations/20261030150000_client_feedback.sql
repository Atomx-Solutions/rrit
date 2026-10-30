-- Clients tell the team what to improve from inside the app. Feedback is a
-- one-way note: the client never sees it again, and the superadmin reads it on
-- its own page and deletes it once handled, so nothing is kept longer than
-- needed. Photos live in storage; the row only carries their paths.
--
-- As with package requests, the tenant role never touches the table: it may
-- only call submit_client_feedback, which validates and rate limits.

CREATE TABLE client_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('bug', 'feature', 'improvement', 'other')),
  page_url text NOT NULL CHECK (length(page_url) BETWEEN 1 AND 2000),
  message text NOT NULL CHECK (length(trim(message)) BETWEEN 3 AND 4000),
  photo_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_paths) <= 3),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_feedback_recent ON client_feedback (created_at DESC, id DESC);
CREATE INDEX client_feedback_rate_limit ON client_feedback (user_id, created_at DESC);

ALTER TABLE client_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE client_feedback FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.submit_client_feedback(
  p_organization_id uuid,
  p_user_id uuid,
  p_category text,
  p_page_url text,
  p_message text,
  p_photo_paths text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  new_id uuid;
  recent integer;
BEGIN
  SELECT pg_catalog.count(*) INTO recent
  FROM public.client_feedback
  WHERE user_id = p_user_id
    AND created_at > pg_catalog.now() - interval '1 hour';
  IF recent >= 10 THEN
    RAISE EXCEPTION 'FEEDBACK_RATE_LIMITED' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.client_feedback
      (organization_id, user_id, category, page_url, message, photo_paths)
    VALUES (
      p_organization_id,
      p_user_id,
      p_category,
      pg_catalog.btrim(p_page_url),
      pg_catalog.btrim(p_message),
      COALESCE(p_photo_paths, '{}')
    )
    RETURNING id INTO new_id;
  EXCEPTION
    WHEN check_violation OR not_null_violation OR foreign_key_violation THEN
      RAISE EXCEPTION 'FEEDBACK_INVALID' USING ERRCODE = 'P0001';
  END;

  RETURN new_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_client_feedback()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'feedback', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(feedback)
          || pg_catalog.jsonb_build_object(
            'organization_name', organization.name,
            'user_email', author.email
          )
        ORDER BY feedback.created_at DESC, feedback.id DESC
      )
      FROM public.client_feedback AS feedback
      LEFT JOIN public.organizations AS organization ON organization.id = feedback.organization_id
      LEFT JOIN auth.users AS author ON author.id = feedback.user_id
    ), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_client_feedback_photo(p_feedback_id uuid, p_index integer)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT photo_paths[p_index + 1] FROM public.client_feedback WHERE id = p_feedback_id;
$function$;

-- Removes the row and hands back its photo paths so the caller can remove the
-- files too. The audit keeps that feedback existed, not what it said.
CREATE OR REPLACE FUNCTION public.admin_delete_client_feedback(
  p_feedback_id uuid,
  p_actor_id uuid,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  deleted_row public.client_feedback%ROWTYPE;
BEGIN
  DELETE FROM public.client_feedback WHERE id = p_feedback_id RETURNING * INTO deleted_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FEEDBACK_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'client_feedback', p_feedback_id::text,
    pg_catalog.jsonb_build_object('organization_id', deleted_row.organization_id, 'category', deleted_row.category),
    NULL,
    pg_catalog.jsonb_build_object('deleted', true)
  );
  RETURN pg_catalog.jsonb_build_object('photo_paths', pg_catalog.to_jsonb(deleted_row.photo_paths));
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
          'client_feedback'
        ))
  );

REVOKE ALL ON FUNCTION public.submit_client_feedback(uuid, uuid, text, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_client_feedback() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_client_feedback_photo(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_client_feedback(uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_client_feedback(uuid, uuid, text, text, text, text[]) TO app_runtime;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_client_feedback() TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_client_feedback_photo(uuid, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_delete_client_feedback(uuid, uuid, text) TO service_role;
  END IF;
END
$$;
