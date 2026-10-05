-- A single, configurable reminder is sent before each active custom package expires.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS package_expiry_reminder_days integer NOT NULL DEFAULT 7
    CHECK (package_expiry_reminder_days BETWEEN 1 AND 365);

CREATE TABLE public.package_expiry_reminders (
  package_id uuid PRIMARY KEY REFERENCES public.custom_packages(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider_message_id text,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX package_expiry_reminders_pending
  ON public.package_expiry_reminders (status, updated_at)
  WHERE status <> 'sent';

ALTER TABLE public.package_expiry_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.package_expiry_reminders FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_update_platform_settings(
  p_actor_id uuid, p_actor_email text, p_changes jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE before_row public.platform_settings%ROWTYPE; after_row public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.platform_settings WHERE singleton FOR UPDATE;
  BEGIN
    UPDATE public.platform_settings SET
      ai_top_up_url = COALESCE(p_changes->>'ai_top_up_url', ai_top_up_url),
      ai_warn_balance_usd = COALESCE((p_changes->>'ai_warn_balance_usd')::numeric, ai_warn_balance_usd),
      ai_low_balance_usd = COALESCE((p_changes->>'ai_low_balance_usd')::numeric, ai_low_balance_usd),
      custom_package_post_price_cents = COALESCE((p_changes->>'custom_package_post_price_cents')::integer, custom_package_post_price_cents),
      custom_package_credits_per_post = COALESCE((p_changes->>'custom_package_credits_per_post')::integer, custom_package_credits_per_post),
      package_expiry_reminder_days = COALESCE((p_changes->>'package_expiry_reminder_days')::integer, package_expiry_reminder_days),
      package_request_post_options = COALESCE((SELECT pg_catalog.array_agg(DISTINCT value::integer ORDER BY value::integer) FROM pg_catalog.jsonb_array_elements_text(CASE WHEN p_changes ? 'package_request_post_options' THEN p_changes->'package_request_post_options' END) AS value), package_request_post_options),
      updated_at = pg_catalog.now()
    WHERE singleton RETURNING * INTO after_row;
  EXCEPTION WHEN check_violation OR invalid_text_representation THEN
    RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE = 'P0001';
  END;
  PERFORM public.admin_record_platform_change(p_actor_id, p_actor_email, 'platform_settings', 'platform_settings', pg_catalog.to_jsonb(before_row) - 'singleton', pg_catalog.to_jsonb(after_row) - 'singleton', p_changes);
  RETURN pg_catalog.to_jsonb(after_row) - 'singleton';
END $function$;

REVOKE ALL ON FUNCTION public.admin_update_platform_settings(uuid, text, jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_update_platform_settings(uuid, text, jsonb) TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.package_expiry_reminders TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    GRANT SELECT ON public.platform_settings, public.custom_packages, public.organizations, public.organization_memberships TO rrit_worker;
    GRANT SELECT, INSERT, UPDATE ON public.package_expiry_reminders TO rrit_worker;
    EXECUTE 'CREATE POLICY package_expiry_reminders_worker_read ON public.package_expiry_reminders FOR SELECT TO rrit_worker USING (true)';
    EXECUTE 'CREATE POLICY package_expiry_reminders_worker_write ON public.package_expiry_reminders FOR ALL TO rrit_worker USING (true) WITH CHECK (true)';
  END IF;
END $$;
