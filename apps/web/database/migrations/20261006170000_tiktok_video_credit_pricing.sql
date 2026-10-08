ALTER TABLE credit_pricing
  ADD COLUMN IF NOT EXISTS tiktok_video_credits integer NOT NULL DEFAULT 5
    CHECK (tiktok_video_credits > 0 AND tiktok_video_credits <= 100000);

CREATE OR REPLACE FUNCTION public.admin_update_credit_pricing(
  p_actor_id uuid, p_actor_email text, p_changes jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE before_row public.credit_pricing%ROWTYPE; after_row public.credit_pricing%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.credit_pricing WHERE singleton FOR UPDATE;
  BEGIN
    UPDATE public.credit_pricing SET
      credit_price_cents = COALESCE((p_changes->>'credit_price_cents')::integer, credit_price_cents),
      provider_cost_per_credit_micro_eur = COALESCE((p_changes->>'provider_cost_per_credit_micro_eur')::integer, provider_cost_per_credit_micro_eur),
      low_credit_threshold = COALESCE((p_changes->>'low_credit_threshold')::integer, low_credit_threshold),
      tiktok_video_credits = COALESCE((p_changes->>'tiktok_video_credits')::integer, tiktok_video_credits),
      updated_at = pg_catalog.now()
    WHERE singleton RETURNING * INTO after_row;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE = 'P0001';
  END;
  PERFORM public.admin_record_platform_change(p_actor_id, p_actor_email, 'credit_pricing', 'credit_pricing', pg_catalog.to_jsonb(before_row) - 'singleton', pg_catalog.to_jsonb(after_row) - 'singleton', p_changes);
  RETURN pg_catalog.to_jsonb(after_row) - 'singleton';
END $function$;
