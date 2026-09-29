-- Packages are activated by the team against a cash payment, so the public site
-- and the app ask for a package instead of selling one. A request is a lead,
-- not an agreement: it carries what the customer asked for and nothing about
-- price, and the superadmin turns an accepted one into a custom package.
--
-- Requests arrive from visitors who are not signed in, which is the first
-- unauthenticated write in this schema. The tenant role therefore never touches
-- the table directly: it may only call submit_package_request, which validates
-- its input and enforces its own rate limit.

CREATE TABLE package_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A landing visitor has no organization yet; an in-app request always does.
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  contact_name text NOT NULL CHECK (length(trim(contact_name)) BETWEEN 2 AND 120),
  contact_email text NOT NULL CHECK (contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(contact_email) <= 320),
  phone text CHECK (phone IS NULL OR length(trim(phone)) BETWEEN 4 AND 40),
  posts_requested integer NOT NULL CHECK (posts_requested > 0 AND posts_requested <= 1000),
  message text CHECK (message IS NULL OR length(message) <= 2000),
  source text NOT NULL CHECK (source IN ('landing', 'app')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'declined')),
  -- A keyed hash of the submitter's address, never the address itself. It exists
  -- only to rate limit, and it is what makes the limit survive a restart.
  submitter_hash text CHECK (submitter_hash IS NULL OR submitter_hash ~ '^[a-f0-9]{64}$'),
  handled_at timestamptz,
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_note text CHECK (handled_note IS NULL OR length(handled_note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'new' AND handled_at IS NULL) OR (status <> 'new' AND handled_at IS NOT NULL)),
  CHECK ((source = 'app') = (organization_id IS NOT NULL))
);
CREATE INDEX package_requests_open ON package_requests (created_at DESC, id DESC) WHERE status = 'new';
CREATE INDEX package_requests_organization ON package_requests (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;
CREATE INDEX package_requests_rate_limit ON package_requests (submitter_hash, created_at DESC)
  WHERE submitter_hash IS NOT NULL;

ALTER TABLE package_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE package_requests FROM PUBLIC;

-- The one way in. It is SECURITY DEFINER because the caller has no privilege on
-- the table at all, and it returns nothing about other requests.
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
      pg_catalog.nullif(pg_catalog.btrim(p_phone), ''),
      p_posts_requested,
      pg_catalog.nullif(pg_catalog.btrim(p_message), ''),
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
          || pg_catalog.jsonb_build_object('organization_name', organization.name)
        ORDER BY request.created_at DESC, request.id DESC
      )
      FROM public.package_requests AS request
      LEFT JOIN public.organizations AS organization ON organization.id = request.organization_id
      WHERE p_status IS NULL OR request.status = p_status
    ), '[]'::jsonb)
  );
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
      handled_note = COALESCE(pg_catalog.nullif(pg_catalog.btrim(p_note), ''), handled_note),
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

-- Platform-wide audit rows carry no tenant, so this resource type joins the
-- existing exemption.
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_scope_check;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_scope_check CHECK (
    (organization_id IS NOT NULL AND business_id IS NOT NULL)
    OR (organization_id IS NULL AND business_id IS NULL
        AND resource_type IN ('plan', 'credit_pricing', 'invoice_settings', 'platform_settings', 'package_request'))
  );

REVOKE ALL ON FUNCTION public.submit_package_request(text, text, integer, text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_package_requests(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_package_request(uuid, uuid, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_package_request(text, text, integer, text, uuid, text, text, text) TO app_runtime;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_package_requests(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_update_package_request(uuid, uuid, text, text, text) TO service_role;
  END IF;
END
$$;
