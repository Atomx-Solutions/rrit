-- Deleting a package also deletes the extra packages merged into it (the
-- parent_package_id cascade), but their credits stayed in the balance: they
-- were granted under each extra's own id, and a parent that had already ended
-- looked as if its credits were gone. Deleting a package now takes back what
-- the whole tree still holds.
--
-- With no other package in force, every unused credit belongs to this tree and
-- is removed. With another package in force, only what this tree granted and
-- has not yet lost is removed, so the other package keeps its own credits.
-- Credits reserved by work already running always stay.

CREATE OR REPLACE FUNCTION app.remove_package_tree_credits(p_package_id uuid, p_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  package_row public.custom_packages%ROWTYPE;
  tree_ids text[];
  granted bigint;
  taken bigint;
  balance record;
  unused bigint;
  amount bigint;
BEGIN
  SELECT * INTO package_row FROM public.custom_packages WHERE id = p_package_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT pg_catalog.array_agg(id::text) INTO tree_ids
    FROM public.custom_packages
   WHERE id = p_package_id OR parent_package_id = p_package_id;

  SELECT remaining_credits, reserved_credits INTO balance
    FROM public.credit_balances
   WHERE organization_id = package_row.organization_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  unused := balance.remaining_credits - balance.reserved_credits;
  IF unused <= 0 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.custom_packages AS other
     WHERE other.organization_id = package_row.organization_id
       AND other.id::text <> ALL (tree_ids)
       AND other.status = 'active'
       AND other.starts_at <= p_at
       AND other.ends_at > p_at
  ) THEN
    SELECT COALESCE(pg_catalog.sum(credit_delta) FILTER (WHERE event_type = 'grant'), 0),
           COALESCE(-pg_catalog.sum(credit_delta) FILTER (WHERE event_type = 'expire'), 0)
      INTO granted, taken
      FROM public.credit_ledger
     WHERE organization_id = package_row.organization_id
       AND reference_type = 'custom_package'
       AND reference_id = ANY (tree_ids);
    amount := LEAST(unused, GREATEST(granted - taken, 0));
  ELSE
    amount := unused;
  END IF;
  IF amount <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.credit_ledger
    (organization_id, event_type, credit_delta, reference_type, reference_id, idempotency_key, metadata)
  VALUES (
    package_row.organization_id, 'expire', -amount, 'custom_package', package_row.id::text,
    'package-delete:' || package_row.id::text,
    pg_catalog.jsonb_build_object('reason', 'package_deleted', 'packages', tree_ids, 'reserved_kept', balance.reserved_credits)
  )
  ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.credit_balances
     SET remaining_credits = remaining_credits - amount, updated_at = p_at
   WHERE organization_id = package_row.organization_id;
END
$function$;
REVOKE ALL ON FUNCTION app.remove_package_tree_credits(uuid, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_delete_custom_package(
  p_package_id uuid,
  p_actor_id uuid,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  package_row public.custom_packages%ROWTYPE;
BEGIN
  SELECT * INTO package_row
  FROM public.custom_packages
  WHERE id = p_package_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Take back the credits of the package and of every extra merged into it,
  -- before the cascade removes the rows they were granted under.
  PERFORM app.remove_package_tree_credits(package_row.id, pg_catalog.now());

  DELETE FROM public.custom_packages WHERE id = package_row.id;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    package_row.organization_id, package_row.organization_id, p_actor_id,
    'admin_custom_package.delete', 'custom_package', package_row.id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_custom_package_deleted',
      'actor_email', p_actor_email,
      'before', pg_catalog.to_jsonb(package_row)
    ),
    0
  );
  RETURN pg_catalog.jsonb_build_object('deleted', true, 'id', package_row.id);
END
$function$;
REVOKE ALL ON FUNCTION public.admin_delete_custom_package(uuid, uuid, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_delete_custom_package(uuid, uuid, text) TO service_role;
  END IF;
END $$;
