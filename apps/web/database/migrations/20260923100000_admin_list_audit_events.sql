-- Platform-wide audit log for the superadmin: newest first, filtered by
-- organization, actor email, action (event type) and date range. Filter
-- options (actions and organizations that appear in the log) are returned too,
-- so the page needs a single call. Callable only by the service role.
CREATE OR REPLACE FUNCTION public.admin_list_audit_events(
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 25,
  p_organization_id uuid DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH params AS (
    SELECT
      GREATEST(COALESCE(p_page, 1), 1) AS page,
      LEAST(GREATEST(COALESCE(p_per_page, 25), 1), 100) AS per_page,
      NULLIF(pg_catalog.btrim(p_actor), '') AS actor
  ),
  filtered AS (
    SELECT event.id, event.created_at, event.action, event.actor_id, account.email AS actor_email,
      event.organization_id, organization.name AS organization_name,
      event.resource_type, event.resource_id, event.result, event.metadata
    FROM public.audit_events AS event
    CROSS JOIN params
    LEFT JOIN auth.users AS account ON account.id = event.actor_id
    LEFT JOIN public.organizations AS organization ON organization.id = event.organization_id
    WHERE (p_organization_id IS NULL OR event.organization_id = p_organization_id)
      AND (p_action IS NULL OR event.action = p_action)
      AND (p_from IS NULL OR event.created_at >= p_from)
      AND (p_to IS NULL OR event.created_at < p_to)
      -- Case-insensitive actor email search; % and _ typed by the admin are literal.
      AND (
        params.actor IS NULL
        OR account.email ILIKE
          '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(params.actor, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          ESCAPE '\'
      )
  ),
  page_rows AS (
    SELECT filtered.*
    FROM filtered, params
    ORDER BY filtered.created_at DESC, filtered.id DESC
    LIMIT (SELECT per_page FROM params)
    OFFSET ((SELECT page FROM params) - 1) * (SELECT per_page FROM params)
  )
  SELECT pg_catalog.jsonb_build_object(
    'items', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', page_rows.id,
        'created_at', page_rows.created_at,
        'action', page_rows.action,
        'actor_id', page_rows.actor_id,
        'actor_email', page_rows.actor_email,
        'organization_id', page_rows.organization_id,
        'organization_name', page_rows.organization_name,
        'resource_type', page_rows.resource_type,
        'resource_id', page_rows.resource_id,
        'result', page_rows.result,
        'metadata', page_rows.metadata
      ) ORDER BY page_rows.created_at DESC, page_rows.id DESC)
      FROM page_rows
    ), '[]'::jsonb),
    'total', (SELECT pg_catalog.count(*) FROM filtered),
    'page', (SELECT page FROM params),
    'per_page', (SELECT per_page FROM params),
    'actions', COALESCE((
      SELECT pg_catalog.jsonb_agg(action ORDER BY action)
      FROM (SELECT DISTINCT event.action FROM public.audit_events AS event) AS actions
    ), '[]'::jsonb),
    'organizations', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', organization.id, 'name', organization.name) ORDER BY organization.name)
      FROM public.organizations AS organization
      WHERE EXISTS (SELECT 1 FROM public.audit_events AS event WHERE event.organization_id = organization.id)
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_list_audit_events(integer, integer, uuid, text, text, timestamptz, timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_list_audit_events(integer, integer, uuid, text, text, timestamptz, timestamptz) TO service_role;
  END IF;
END
$$;
