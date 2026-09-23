-- Platform settings the superadmin edits from the admin area. The first one is
-- where "Add credit" sends the admin: the provider's own top-up page, since
-- OpenRouter has no card-payment API of its own.
CREATE TABLE IF NOT EXISTS public.platform_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  -- Length is checked separately: a POSIX repetition count cannot exceed 255.
  ai_top_up_url text NOT NULL DEFAULT 'https://openrouter.ai/settings/credits'
    CHECK (ai_top_up_url ~ '^https://[^[:space:]]+$' AND length(ai_top_up_url) BETWEEN 12 AND 300),
  ai_low_balance_usd numeric(10, 2) NOT NULL DEFAULT 10 CHECK (ai_low_balance_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_settings FROM PUBLIC;

-- Platform-wide audit events carry no tenant; allow this resource type too.
ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_scope_check;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_scope_check CHECK (
    (organization_id IS NOT NULL AND business_id IS NOT NULL)
    OR (organization_id IS NULL AND business_id IS NULL
        AND resource_type IN ('plan', 'credit_pricing', 'invoice_settings', 'platform_settings'))
  );

CREATE OR REPLACE FUNCTION public.admin_platform_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.to_jsonb(settings) - 'singleton' FROM public.platform_settings AS settings;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_platform_settings(
  p_actor_id uuid,
  p_actor_email text,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.platform_settings%ROWTYPE;
  after_row public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.platform_settings WHERE singleton FOR UPDATE;
  BEGIN
    UPDATE public.platform_settings SET
      ai_top_up_url = COALESCE(p_changes->>'ai_top_up_url', ai_top_up_url),
      ai_low_balance_usd = COALESCE((p_changes->>'ai_low_balance_usd')::numeric, ai_low_balance_usd),
      updated_at = pg_catalog.now()
    WHERE singleton
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE = 'P0001';
  END;
  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'platform_settings', 'platform_settings',
    pg_catalog.to_jsonb(before_row) - 'singleton',
    pg_catalog.to_jsonb(after_row) - 'singleton',
    p_changes
  );
  RETURN pg_catalog.to_jsonb(after_row) - 'singleton';
END
$function$;

REVOKE ALL ON FUNCTION public.admin_platform_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_platform_settings(uuid, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_platform_settings() TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_update_platform_settings(uuid, text, jsonb) TO service_role;
  END IF;
END
$$;
