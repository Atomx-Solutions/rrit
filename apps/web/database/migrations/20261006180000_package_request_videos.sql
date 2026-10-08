ALTER TABLE public.package_requests
  ADD COLUMN IF NOT EXISTS videos_requested integer NOT NULL DEFAULT 0;
ALTER TABLE public.package_requests
  ADD CONSTRAINT package_requests_videos_requested_check CHECK (videos_requested >= 0 AND videos_requested <= 1000);
ALTER TABLE public.package_requests DROP CONSTRAINT IF EXISTS package_requests_asks_for_something_check;
ALTER TABLE public.package_requests ADD CONSTRAINT package_requests_asks_for_something_check CHECK (posts_requested > 0 OR credits_requested > 0 OR videos_requested > 0);

DROP FUNCTION IF EXISTS public.submit_package_request(text,text,integer,text,uuid,text,text,text,text,text,text,integer);
CREATE FUNCTION public.submit_package_request(
  p_contact_name text, p_contact_email text, p_posts_requested integer, p_source text,
  p_organization_id uuid DEFAULT NULL, p_phone text DEFAULT NULL, p_message text DEFAULT NULL,
  p_submitter_hash text DEFAULT NULL, p_business_name text DEFAULT NULL, p_industry text DEFAULT NULL,
  p_platform text DEFAULT NULL, p_credits_requested integer DEFAULT 0, p_videos_requested integer DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE new_id uuid; recent integer;
BEGIN
  IF p_submitter_hash IS NOT NULL THEN
    SELECT count(*) INTO recent FROM public.package_requests WHERE submitter_hash=p_submitter_hash AND created_at > now() - interval '1 hour';
    IF recent >= 5 THEN RAISE EXCEPTION 'REQUEST_RATE_LIMITED' USING ERRCODE='P0001'; END IF;
  END IF;
  BEGIN
    INSERT INTO public.package_requests(organization_id,contact_name,contact_email,phone,posts_requested,credits_requested,videos_requested,message,source,submitter_hash,business_name,industry,platform)
    VALUES(p_organization_id,btrim(p_contact_name),lower(btrim(p_contact_email)),nullif(btrim(p_phone),''),p_posts_requested,coalesce(p_credits_requested,0),coalesce(p_videos_requested,0),nullif(btrim(p_message),''),p_source,p_submitter_hash,nullif(btrim(p_business_name),''),nullif(btrim(p_industry),''),p_platform)
    RETURNING id INTO new_id;
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation THEN
    RAISE EXCEPTION 'REQUEST_INVALID' USING ERRCODE='P0001';
  END;
  RETURN new_id;
END $function$;
REVOKE ALL ON FUNCTION public.submit_package_request(text,text,integer,text,uuid,text,text,text,text,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_package_request(text,text,integer,text,uuid,text,text,text,text,text,text,integer,integer) TO app_runtime;
