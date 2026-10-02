-- A request may now ask for credits as well as posts. The entry point keeps
-- enforcing the rate limit and the validation, so the new field goes through
-- the same function rather than around it.

CREATE OR REPLACE FUNCTION public.submit_package_request(
  p_contact_name text,
  p_contact_email text,
  p_posts_requested integer,
  p_source text,
  p_organization_id uuid DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_submitter_hash text DEFAULT NULL,
  p_business_name text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_credits_requested integer DEFAULT 0
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
      (organization_id, contact_name, contact_email, phone, posts_requested, credits_requested,
       message, source, submitter_hash, business_name, industry, platform)
    VALUES (
      p_organization_id,
      pg_catalog.btrim(p_contact_name),
      pg_catalog.lower(pg_catalog.btrim(p_contact_email)),
      NULLIF(pg_catalog.btrim(p_phone), ''),
      p_posts_requested,
      COALESCE(p_credits_requested, 0),
      NULLIF(pg_catalog.btrim(p_message), ''),
      p_source,
      p_submitter_hash,
      NULLIF(pg_catalog.btrim(p_business_name), ''),
      NULLIF(pg_catalog.btrim(p_industry), ''),
      p_platform
    )
    RETURNING id INTO new_id;
  EXCEPTION
    WHEN check_violation OR not_null_violation OR foreign_key_violation THEN
      RAISE EXCEPTION 'REQUEST_INVALID' USING ERRCODE = 'P0001';
  END;

  RETURN new_id;
END
$function$;

REVOKE ALL ON FUNCTION public.submit_package_request(text, text, integer, text, uuid, text, text, text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_package_request(text, text, integer, text, uuid, text, text, text, text, text, text, integer) TO app_runtime;

-- The eleven-argument overload would still satisfy a call that omits the
-- credits, leaving two definitions of the same operation.
DROP FUNCTION IF EXISTS public.submit_package_request(text, text, integer, text, uuid, text, text, text, text, text, text);
