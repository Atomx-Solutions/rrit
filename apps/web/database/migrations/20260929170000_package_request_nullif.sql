-- NULLIF is SQL syntax rather than a function in pg_catalog, so qualifying it
-- made every submission fail at runtime. The functions are otherwise unchanged.

CREATE OR REPLACE FUNCTION public.submit_package_request(
  p_contact_name text,
  p_contact_email text,
  p_posts_requested integer,
  p_source text,
  p_organization_id uuid DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_submitter_hash text DEFAULT NULL
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
  IF p_submitter_hash IS NOT NULL THEN
    SELECT pg_catalog.count(*) INTO recent
    FROM public.package_requests
    WHERE submitter_hash = p_submitter_hash
      AND created_at > pg_catalog.now() - interval '1 hour';
    IF recent >= 5 THEN
      RAISE EXCEPTION 'REQUEST_RATE_LIMITED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.package_requests
      (organization_id, contact_name, contact_email, phone, posts_requested, message, source, submitter_hash)
    VALUES (
      p_organization_id,
      pg_catalog.btrim(p_contact_name),
      pg_catalog.lower(pg_catalog.btrim(p_contact_email)),
      NULLIF(pg_catalog.btrim(p_phone), ''),
      p_posts_requested,
      NULLIF(pg_catalog.btrim(p_message), ''),
      p_source,
      p_submitter_hash
    )
    RETURNING id INTO new_id;
  EXCEPTION
    WHEN check_violation OR not_null_violation OR foreign_key_violation THEN
      RAISE EXCEPTION 'REQUEST_INVALID' USING ERRCODE = 'P0001';
  END;

  RETURN new_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_package_request(
  p_request_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.package_requests%ROWTYPE;
  after_row public.package_requests%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.package_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.package_requests SET
      status = p_status,
      -- Reopening a request clears who closed it, so the record never claims a
      -- decision that was taken back.
      handled_at = CASE WHEN p_status = 'new' THEN NULL ELSE pg_catalog.now() END,
      handled_by = CASE WHEN p_status = 'new' THEN NULL ELSE p_actor_id END,
      handled_note = COALESCE(NULLIF(pg_catalog.btrim(p_note), ''), handled_note),
      updated_at = pg_catalog.now()
    WHERE id = p_request_id
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'REQUEST_INVALID' USING ERRCODE = 'P0001';
  END;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'package_request', p_request_id::text,
    pg_catalog.to_jsonb(before_row) - 'submitter_hash',
    pg_catalog.to_jsonb(after_row) - 'submitter_hash',
    pg_catalog.jsonb_build_object('status', p_status)
  );
  RETURN pg_catalog.to_jsonb(after_row) - 'submitter_hash';
END
$function$;

REVOKE ALL ON FUNCTION public.submit_package_request(text, text, integer, text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_package_request(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_package_request(text, text, integer, text, uuid, text, text, text) TO app_runtime;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_update_package_request(uuid, uuid, text, text, text) TO service_role;
  END IF;
END
$$;
