-- A proposal may now carry credits as well as posts. The suggested price adds
-- the credits at the configured per-credit sale price, the same number the
-- superadmin sets on the credits screen, so the two prices stay one setting
-- rather than becoming two.

CREATE OR REPLACE FUNCTION public.admin_custom_package_credit_rate()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT credit_price_cents FROM public.credit_pricing WHERE singleton = true;
$function$;

REVOKE ALL ON FUNCTION public.admin_custom_package_credit_rate() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_create_custom_package(p_organization_id uuid, p_actor_id uuid, p_actor_email text, p_package jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  created_row public.custom_packages%ROWTYPE;
  posts_included integer := COALESCE((p_package->>'posts_included')::integer, 0);
  credits_included integer := COALESCE((p_package->>'credits_included')::integer, 0);
  rate integer;
  credit_rate integer;
  suggested integer;
  invoice_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=p_organization_id) THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE='P0001';
  END IF;
  rate := COALESCE((p_package->>'post_price_cents')::integer, public.admin_custom_package_post_rate());
  credit_rate := COALESCE(public.admin_custom_package_credit_rate(), 0);
  suggested := posts_included * rate + credits_included * credit_rate;
  BEGIN
    INSERT INTO public.custom_packages (organization_id,name,posts_included,credits_included,post_price_cents,price_cents,suggested_price_cents,starts_at,ends_at,status,notes,package_request_id)
    VALUES (
      p_organization_id,
      p_package->>'name',
      posts_included,
      credits_included,
      rate,
      COALESCE((p_package->>'price_cents')::integer,suggested),
      suggested,
      (p_package->>'starts_at')::timestamptz,
      (p_package->>'ends_at')::timestamptz,
      p_package->>'status',
      p_package->>'notes',
      (p_package->>'package_request_id')::uuid
    )
    RETURNING * INTO created_row;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE='P0001';
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR foreign_key_violation THEN RAISE EXCEPTION 'PACKAGE_INVALID' USING ERRCODE='P0001';
  END;
  IF created_row.status='active' THEN invoice_id := public.admin_issue_custom_package_invoice(created_row.id); END IF;
  INSERT INTO public.audit_events (business_id,organization_id,actor_id,action,resource_type,resource_id,result,metadata,revision)
  VALUES (NULL,NULL,p_actor_id,'admin_custom_package.create','custom_package',created_row.id::text,'succeeded',pg_catalog.jsonb_build_object('event_type','admin_custom_package_change','actor_email',p_actor_email,'changes',p_package,'after',pg_catalog.to_jsonb(created_row),'invoice_id',invoice_id),0);
  RETURN pg_catalog.to_jsonb(created_row) || pg_catalog.jsonb_build_object('invoice_id',invoice_id);
END $function$;

REVOKE ALL ON FUNCTION public.admin_create_custom_package(uuid, uuid, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_create_custom_package(uuid, uuid, text, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_custom_package_credit_rate() TO service_role;
  END IF;
END
$$;
