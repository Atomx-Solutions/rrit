-- Public leads start without an organization. The superadmin must be able to
-- assign one while sending a proposal, including when that organization is
-- already active. Remove only the legacy source/organization coupling check;
-- the foreign key and all status/value checks remain enforced.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.package_requests'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%source%'
    AND pg_get_constraintdef(oid) ILIKE '%organization_id%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.package_requests DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
