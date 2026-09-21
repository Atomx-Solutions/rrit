-- RRIT-SA-07: platform-wide organization details, including auth.users email
-- addresses, are read only through the server's Supabase service-role client.
CREATE OR REPLACE FUNCTION public.admin_organization_details(target_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'id', organization.id,
    'slug', organization.slug,
    'name', organization.name,
    'status', organization.status,
    'created_at', organization.created_at,
    'members', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'user_id', membership.user_id,
          'email', auth_user.email,
          'role', membership.role,
          'status', membership.status,
          'created_at', membership.created_at
        )
        ORDER BY membership.created_at ASC, membership.user_id ASC
      )
      FROM public.organization_memberships AS membership
      LEFT JOIN auth.users AS auth_user ON auth_user.id = membership.user_id
      WHERE membership.organization_id = organization.id
    ), '[]'::jsonb),
    'brands', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', brand.id,
          'name', brand.name,
          'slug', brand.slug,
          'status', brand.status,
          'category', brand.category,
          'created_at', brand.created_at
        )
        ORDER BY brand.created_at ASC, brand.id ASC
      )
      FROM public.brands AS brand
      WHERE brand.organization_id = organization.id
    ), '[]'::jsonb),
    'subscription', (
      SELECT pg_catalog.jsonb_build_object(
        'id', subscription.id,
        'plan_code', subscription.plan_code,
        'plan_name', plan.name,
        'billing_interval', subscription.billing_interval,
        'status', subscription.status,
        'current_period_start', subscription.current_period_start,
        'current_period_end', subscription.current_period_end,
        'price_cents', subscription.price_cents,
        'paused_at', subscription.paused_at,
        'paused_by', subscription.paused_by,
        'paused_reason', subscription.paused_reason
      )
      FROM public.subscriptions AS subscription
      JOIN public.plans AS plan ON plan.code = subscription.plan_code
      WHERE subscription.organization_id = organization.id
      ORDER BY subscription.created_at DESC, subscription.id DESC
      LIMIT 1
    ),
    'credit_balance', (
      SELECT pg_catalog.jsonb_build_object(
        'remaining_credits', balance.remaining_credits,
        'reserved_credits', balance.reserved_credits,
        'period_start', balance.period_start,
        'period_end', balance.period_end
      )
      FROM public.credit_balances AS balance
      WHERE balance.organization_id = organization.id
    ),
    'invoices', COALESCE((
      SELECT pg_catalog.jsonb_agg(invoice_row.payload ORDER BY invoice_row.issued_at DESC, invoice_row.id DESC)
      FROM (
        SELECT
          invoice.id,
          invoice.issued_at,
          pg_catalog.jsonb_build_object(
            'id', invoice.id,
            'number', invoice.number,
            'kind', invoice.kind,
            'total_cents', invoice.total_cents,
            'issued_at', invoice.issued_at,
            'source_type', invoice.source_type
          ) AS payload
        FROM public.invoices AS invoice
        WHERE invoice.organization_id = organization.id
        ORDER BY invoice.issued_at DESC, invoice.sequence DESC
        LIMIT 10
      ) AS invoice_row
    ), '[]'::jsonb),
    'billing_details', (
      SELECT pg_catalog.jsonb_build_object(
        'legal_name', details.legal_name,
        'address', details.address,
        'city', details.city,
        'country', details.country,
        'fiscal_number', details.fiscal_number
      )
      FROM public.organization_billing_details AS details
      WHERE details.organization_id = organization.id
    )
  )
  FROM public.organizations AS organization
  WHERE organization.id = target_organization_id;
$function$;

REVOKE ALL ON FUNCTION public.admin_organization_details(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_organization_details(uuid) TO service_role;
  END IF;
END
$$;
