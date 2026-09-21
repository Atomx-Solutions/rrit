-- RRIT-SA-09: paginated platform user list for the superadmin.
-- auth.admin.listUsers() cannot search by email, and filtering one fetched
-- page would break pagination and totals, so the list is built here, like
-- admin_list_organizations, and callable only by the service role.
CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 25,
  p_q text DEFAULT NULL
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
      NULLIF(pg_catalog.btrim(p_q), '') AS q
  ),
  filtered AS (
    SELECT account.id, account.email, account.created_at, account.last_sign_in_at
    FROM auth.users AS account
    CROSS JOIN params
    WHERE account.deleted_at IS NULL
      -- Case-insensitive email search; % and _ typed by the admin are literal.
      AND (
        params.q IS NULL
        OR account.email ILIKE
          '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(params.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          ESCAPE '\'
      )
  ),
  page_rows AS (
    SELECT filtered.*
    FROM filtered
    ORDER BY filtered.created_at DESC, filtered.id DESC
    LIMIT (SELECT per_page FROM params)
    OFFSET ((SELECT page FROM params) - 1) * (SELECT per_page FROM params)
  )
  SELECT pg_catalog.jsonb_build_object(
    'page', (SELECT page FROM params),
    'per_page', (SELECT per_page FROM params),
    'total', (SELECT pg_catalog.count(*) FROM filtered),
    'items', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', row.id,
          'email', row.email,
          'created_at', row.created_at,
          'last_sign_in_at', row.last_sign_in_at,
          'organizations', COALESCE((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object('id', organization.id, 'name', organization.name, 'role', membership.role)
              ORDER BY organization.name
            )
            FROM public.organization_memberships AS membership
            JOIN public.organizations AS organization ON organization.id = membership.organization_id
            WHERE membership.user_id = row.id AND membership.status = 'active'
          ), '[]'::jsonb)
        )
        ORDER BY row.created_at DESC, row.id DESC
      )
      FROM page_rows AS row
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_list_users(integer, integer, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_list_users(integer, integer, text) TO service_role;
  END IF;
END
$$;
