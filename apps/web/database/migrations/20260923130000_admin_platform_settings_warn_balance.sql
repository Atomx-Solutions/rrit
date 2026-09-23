-- Two levels for the AI balance: a warning while it is getting close, and the
-- critical amount below which the AI stops working.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS ai_warn_balance_usd numeric(10, 2) NOT NULL DEFAULT 30;
ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_ai_warn_balance_usd_check;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_ai_warn_balance_usd_check CHECK (ai_warn_balance_usd >= 0);

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
      ai_warn_balance_usd = COALESCE((p_changes->>'ai_warn_balance_usd')::numeric, ai_warn_balance_usd),
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

REVOKE ALL ON FUNCTION public.admin_update_platform_settings(uuid, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_update_platform_settings(uuid, text, jsonb) TO service_role;
  END IF;
END
$$;
