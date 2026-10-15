-- The sign-in and recovery forms tell a visitor when an address has no account,
-- instead of leaving them waiting for an email that will never come. Answering
-- that question reveals whether an address is registered, so every lookup is
-- counted per visitor and refused past the limit.

CREATE TABLE auth_email_lookups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submitter_hash text NOT NULL CHECK (submitter_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_email_lookups_rate_limit ON auth_email_lookups (submitter_hash, created_at DESC);
ALTER TABLE auth_email_lookups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_email_lookups FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.auth_email_registered(
  p_email text,
  p_submitter_hash text,
  p_hourly_limit integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  recent integer;
BEGIN
  IF p_submitter_hash IS NOT NULL THEN
    SELECT pg_catalog.count(*) INTO recent
      FROM public.auth_email_lookups
     WHERE submitter_hash = p_submitter_hash
       AND created_at > pg_catalog.now() - interval '1 hour';
    IF recent >= p_hourly_limit THEN
      RAISE EXCEPTION 'EMAIL_LOOKUP_RATE_LIMITED' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.auth_email_lookups (submitter_hash) VALUES (p_submitter_hash);
    -- Old counts serve no limit; drop them as the table is used.
    DELETE FROM public.auth_email_lookups WHERE created_at < pg_catalog.now() - interval '1 day';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM auth.users
     WHERE pg_catalog.lower(email) = pg_catalog.lower(pg_catalog.btrim(p_email))
       AND deleted_at IS NULL
  );
END
$function$;
REVOKE ALL ON FUNCTION public.auth_email_registered(text, text, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.auth_email_registered(text, text, integer) TO service_role;
  END IF;
END
$$;
