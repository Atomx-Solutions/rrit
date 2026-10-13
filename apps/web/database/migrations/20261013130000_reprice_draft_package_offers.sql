-- Pending proposals have not been accepted or invoiced yet, so their item
-- rates and total must follow the current superadmin settings.
UPDATE public.custom_packages AS package
SET post_price_cents = settings.custom_package_post_price_cents,
    video_price_cents = settings.custom_package_video_price_cents,
    suggested_price_cents = package.posts_included * settings.custom_package_post_price_cents
      + package.videos_included * settings.custom_package_video_price_cents
      + package.credits_included * COALESCE((SELECT credit_price_cents FROM public.credit_pricing WHERE singleton), 0),
    price_cents = package.posts_included * settings.custom_package_post_price_cents
      + package.videos_included * settings.custom_package_video_price_cents
      + package.credits_included * COALESCE((SELECT credit_price_cents FROM public.credit_pricing WHERE singleton), 0),
    currency = CASE WHEN settings.package_currency = 'EUR' THEN 'EUR' ELSE 'CHF' END,
    updated_at = now()
FROM public.platform_settings AS settings
WHERE settings.singleton
  AND package.status = 'draft';
