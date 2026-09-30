-- Custom-package administration is platform-scoped: a lead organization does
-- not necessarily have a matching legacy business row. Keep both scope fields
-- NULL, as required by audit_events_scope_check.
CREATE OR REPLACE FUNCTION public.admin_add_posts_to_active_custom_package(
  p_organization_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_posts_to_add integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.custom_packages%ROWTYPE;
  after_row public.custom_packages%ROWTYPE;
  added_price integer;
BEGIN
  IF p_posts_to_add IS NULL OR p_posts_to_add < 1 OR p_posts_to_add > 1000 THEN
    RAISE EXCEPTION 'PACKAGE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO before_row
  FROM public.custom_packages
  WHERE organization_id = p_organization_id
    AND status = 'active'
    AND ends_at > pg_catalog.now()
  ORDER BY starts_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_ACTIVE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF before_row.posts_included + p_posts_to_add > 1000 THEN
    RAISE EXCEPTION 'PACKAGE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  added_price := p_posts_to_add * before_row.post_price_cents;

  UPDATE public.custom_packages
  SET posts_included = before_row.posts_included + p_posts_to_add,
      suggested_price_cents = before_row.suggested_price_cents + added_price,
      price_cents = before_row.price_cents + added_price,
      updated_at = pg_catalog.now()
  WHERE id = before_row.id
  RETURNING * INTO after_row;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    NULL, NULL, p_actor_id, 'admin_custom_package.add_posts',
    'custom_package', before_row.id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_custom_package_change',
      'actor_email', p_actor_email,
      'posts_added', p_posts_to_add,
      'parent_post_price_cents', before_row.post_price_cents,
      'added_price_cents', added_price,
      'before', pg_catalog.to_jsonb(before_row),
      'after', pg_catalog.to_jsonb(after_row)
    ),
    0
  );

  RETURN pg_catalog.to_jsonb(after_row);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_add_posts_to_active_custom_package(uuid, uuid, text, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_add_posts_to_active_custom_package(uuid, uuid, text, integer) TO service_role;
  END IF;
END
$$;
