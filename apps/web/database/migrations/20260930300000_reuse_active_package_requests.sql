-- An in-app package request represents the current active package period, not
-- every click on the request form. Reuse that period's row until the package
-- ends; the next package period naturally receives a fresh request.
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
  p_platform text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  request_id uuid;
  active_package public.custom_packages%ROWTYPE;
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

  -- A signed-in client can reopen only its request from the active package's
  -- current period. Landing-page leads always remain separate submissions.
  IF p_source = 'app' AND p_organization_id IS NOT NULL THEN
    SELECT * INTO active_package
    FROM public.custom_packages
    WHERE organization_id = p_organization_id
      AND status = 'active'
      AND starts_at <= pg_catalog.now()
      AND ends_at > pg_catalog.now()
    ORDER BY starts_at DESC, id DESC
    LIMIT 1;

    IF FOUND THEN
      SELECT id INTO request_id
      FROM public.package_requests
      WHERE organization_id = p_organization_id
        AND source = 'app'
        AND created_at >= active_package.starts_at
        AND created_at < active_package.ends_at
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.package_requests
        SET contact_name = pg_catalog.btrim(p_contact_name),
            contact_email = pg_catalog.lower(pg_catalog.btrim(p_contact_email)),
            phone = NULLIF(pg_catalog.btrim(p_phone), ''),
            posts_requested = p_posts_requested,
            message = NULLIF(pg_catalog.btrim(p_message), ''),
            status = 'new',
            handled_at = NULL,
            handled_by = NULL,
            updated_at = pg_catalog.now()
        WHERE id = request_id;
        RETURN request_id;
      END IF;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.package_requests
      (organization_id, contact_name, contact_email, phone, posts_requested, message, source,
       submitter_hash, business_name, industry, platform)
    VALUES (
      p_organization_id,
      pg_catalog.btrim(p_contact_name),
      pg_catalog.lower(pg_catalog.btrim(p_contact_email)),
      NULLIF(pg_catalog.btrim(p_phone), ''),
      p_posts_requested,
      NULLIF(pg_catalog.btrim(p_message), ''),
      p_source,
      p_submitter_hash,
      NULLIF(pg_catalog.btrim(p_business_name), ''),
      NULLIF(pg_catalog.btrim(p_industry), ''),
      p_platform
    )
    RETURNING id INTO request_id;
  EXCEPTION
    WHEN check_violation OR not_null_violation OR foreign_key_violation THEN
      RAISE EXCEPTION 'REQUEST_INVALID' USING ERRCODE = 'P0001';
  END;

  RETURN request_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_package_requests(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'open_count', (SELECT pg_catalog.count(*) FROM public.package_requests WHERE status = 'new'),
    'requests', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(request) - 'submitter_hash'
          || pg_catalog.jsonb_build_object(
            'organization_name', organization.name,
            'active_posts_included', active_package.posts_included
          )
        ORDER BY request.created_at DESC, request.id DESC
      )
      FROM public.package_requests AS request
      LEFT JOIN public.organizations AS organization ON organization.id = request.organization_id
      LEFT JOIN LATERAL (
        SELECT package.posts_included
        FROM public.custom_packages AS package
        WHERE package.organization_id = request.organization_id
          AND package.status = 'active'
          AND package.starts_at <= pg_catalog.now()
          AND package.ends_at > pg_catalog.now()
        ORDER BY package.starts_at DESC, package.id DESC
        LIMIT 1
      ) AS active_package ON true
      WHERE p_status IS NULL OR request.status = p_status
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.submit_package_request(text, text, integer, text, uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_package_requests(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_package_request(text, text, integer, text, uuid, text, text, text, text, text, text) TO app_runtime;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_package_requests(text) TO service_role;
  END IF;
END
$$;
