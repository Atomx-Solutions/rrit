-- A lead from the public site carries what the team needs before it can answer
-- with an offer: who the business is, what it does, where it publishes and how
-- much it wants. None of this creates a package or a payment; it only describes
-- the request.

ALTER TABLE public.package_requests
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS platform text;

ALTER TABLE public.package_requests
  DROP CONSTRAINT IF EXISTS package_requests_business_name_check;
ALTER TABLE public.package_requests
  ADD CONSTRAINT package_requests_business_name_check
  CHECK (business_name IS NULL OR length(trim(business_name)) BETWEEN 2 AND 120);

ALTER TABLE public.package_requests
  DROP CONSTRAINT IF EXISTS package_requests_industry_check;
ALTER TABLE public.package_requests
  ADD CONSTRAINT package_requests_industry_check
  CHECK (industry IS NULL OR length(trim(industry)) BETWEEN 2 AND 100);

-- The channels the product actually publishes to; 'both' is its own answer
-- rather than two rows, because the request is one conversation.
ALTER TABLE public.package_requests
  DROP CONSTRAINT IF EXISTS package_requests_platform_check;
ALTER TABLE public.package_requests
  ADD CONSTRAINT package_requests_platform_check
  CHECK (platform IS NULL OR platform IN ('instagram', 'facebook', 'both'));

-- The quantities offered as a starting point on the form. They are suggestions
-- for the visitor, not a catalogue: every organization still agrees its own
-- volume, so the list is a setting the superadmin changes without a deployment.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS package_request_post_options integer[] NOT NULL DEFAULT '{10,20,30}';
ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_package_request_post_options_check;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_package_request_post_options_check
  CHECK (
    array_length(package_request_post_options, 1) BETWEEN 1 AND 6
    AND 0 < ALL (package_request_post_options)
    AND 1000 >= ALL (package_request_post_options)
  );

CREATE OR REPLACE FUNCTION public.package_request_post_options()
RETURNS integer[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT package_request_post_options FROM public.platform_settings;
$function$;

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
    RETURNING id INTO new_id;
  EXCEPTION
    WHEN check_violation OR not_null_violation OR foreign_key_violation THEN
      RAISE EXCEPTION 'REQUEST_INVALID' USING ERRCODE = 'P0001';
  END;

  RETURN new_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_platform_settings(
  p_actor_id uuid,
  p_actor_email text,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.platform_settings%ROWTYPE;
  after_row public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.platform_settings WHERE singleton FOR UPDATE;
  BEGIN
    UPDATE public.platform_settings SET
      ai_top_up_url = COALESCE(p_changes->>'ai_top_up_url', ai_top_up_url),
      ai_warn_balance_usd = COALESCE((p_changes->>'ai_warn_balance_usd')::numeric, ai_warn_balance_usd),
      ai_low_balance_usd = COALESCE((p_changes->>'ai_low_balance_usd')::numeric, ai_low_balance_usd),
      custom_package_post_price_cents = COALESCE(
        (p_changes->>'custom_package_post_price_cents')::integer,
        custom_package_post_price_cents
      ),
      package_request_post_options = COALESCE(
        (
          SELECT pg_catalog.array_agg(DISTINCT value::integer ORDER BY value::integer)
          FROM pg_catalog.jsonb_array_elements_text(
            CASE WHEN p_changes ? 'package_request_post_options'
              THEN p_changes->'package_request_post_options' END
          ) AS value
        ),
        package_request_post_options
      ),
      updated_at = pg_catalog.now()
    WHERE singleton
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN check_violation OR invalid_text_representation THEN
      RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE = 'P0001';
  END;
  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'platform_settings', 'platform_settings',
    pg_catalog.to_jsonb(before_row) - 'singleton',
    pg_catalog.to_jsonb(after_row) - 'singleton',
    p_changes
  );
  RETURN pg_catalog.to_jsonb(after_row) - 'singleton';
END
$function$;

REVOKE ALL ON FUNCTION public.package_request_post_options() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_package_request(text, text, integer, text, uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_platform_settings(uuid, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.package_request_post_options() TO app_runtime;
GRANT EXECUTE ON FUNCTION public.submit_package_request(text, text, integer, text, uuid, text, text, text, text, text, text) TO app_runtime;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_update_platform_settings(uuid, text, jsonb) TO service_role;
  END IF;
END
$$;

-- The previous eight-argument overload would still satisfy calls that omit the
-- new fields, leaving two definitions of the same operation.
DROP FUNCTION IF EXISTS public.submit_package_request(text, text, integer, text, uuid, text, text, text);
