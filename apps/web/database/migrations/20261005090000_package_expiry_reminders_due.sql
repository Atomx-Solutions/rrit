-- The expiry reminder needs the owner's email, which lives in auth.users. The
-- maintenance worker has no access to that schema, so every retention run was
-- failing with "permission denied for schema auth" and the whole batch rolled
-- back, taking the deletions and the package expiry with it.
--
-- Opening the auth schema to a background role would widen it far beyond the
-- one address this needs, so the lookup moves into a definer function that
-- returns exactly the rows the reminder sends and nothing else.

CREATE OR REPLACE FUNCTION public.package_expiry_reminders_due()
RETURNS TABLE (
  package_id uuid,
  organization_id uuid,
  organization_name text,
  package_name text,
  ends_at timestamptz,
  email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT package.id, package.organization_id, organization.name,
         package.name, package.ends_at, account.email::text
    FROM public.custom_packages AS package
    JOIN public.organizations AS organization ON organization.id = package.organization_id
    JOIN public.organization_memberships AS membership
      ON membership.organization_id = package.organization_id
     AND membership.role = 'owner'
     AND membership.status = 'active'
    JOIN auth.users AS account ON account.id = membership.user_id
    CROSS JOIN public.platform_settings AS settings
    LEFT JOIN public.package_expiry_reminders AS reminder ON reminder.package_id = package.id
   WHERE package.status = 'active'
     AND package.ends_at > pg_catalog.now()
     AND package.ends_at <= pg_catalog.now() + make_interval(days => settings.package_expiry_reminder_days)
     AND (
       reminder.package_id IS NULL
       OR (reminder.status = 'failed' AND reminder.updated_at < pg_catalog.now() - interval '6 hours')
     )
   ORDER BY package.ends_at, package.id
   LIMIT 100;
$function$;

REVOKE ALL ON FUNCTION public.package_expiry_reminders_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.package_expiry_reminders_due() TO rrit_worker;
