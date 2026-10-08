ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS custom_package_video_price_cents integer NOT NULL DEFAULT 200
    CHECK (custom_package_video_price_cents > 0 AND custom_package_video_price_cents <= 1000000);

CREATE OR REPLACE FUNCTION public.admin_update_platform_settings(
  p_actor_id uuid, p_actor_email text, p_changes jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE before_row public.platform_settings%ROWTYPE; after_row public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.platform_settings WHERE singleton FOR UPDATE;
  UPDATE public.platform_settings SET
    custom_package_post_price_cents = COALESCE((p_changes->>'custom_package_post_price_cents')::integer, custom_package_post_price_cents),
    custom_package_video_price_cents = COALESCE((p_changes->>'custom_package_video_price_cents')::integer, custom_package_video_price_cents),
    custom_package_credits_per_post = COALESCE((p_changes->>'custom_package_credits_per_post')::integer, custom_package_credits_per_post),
    package_expiry_reminder_days = COALESCE((p_changes->>'package_expiry_reminder_days')::integer, package_expiry_reminder_days),
    package_request_post_options = COALESCE((SELECT array_agg(DISTINCT value::integer ORDER BY value::integer) FROM jsonb_array_elements_text(CASE WHEN p_changes ? 'package_request_post_options' THEN p_changes->'package_request_post_options' END) AS value), package_request_post_options),
    ai_top_up_url = COALESCE(p_changes->>'ai_top_up_url', ai_top_up_url),
    ai_warn_balance_usd = COALESCE((p_changes->>'ai_warn_balance_usd')::numeric, ai_warn_balance_usd),
    ai_low_balance_usd = COALESCE((p_changes->>'ai_low_balance_usd')::numeric, ai_low_balance_usd), updated_at = now()
  WHERE singleton RETURNING * INTO after_row;
  PERFORM public.admin_record_platform_change(p_actor_id,p_actor_email,'platform_settings','platform_settings',to_jsonb(before_row)-'singleton',to_jsonb(after_row)-'singleton',p_changes);
  RETURN to_jsonb(after_row)-'singleton';
END $function$;

GRANT EXECUTE ON FUNCTION public.admin_update_platform_settings(uuid,text,jsonb) TO service_role;
