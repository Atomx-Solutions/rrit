-- custom_packages_offers_something_check, added with credit top-ups, states what
-- a package has to offer to be worth selling. Videos are now a third thing a
-- package can offer, so a video-only package was being rejected by it.
ALTER TABLE public.custom_packages
  DROP CONSTRAINT IF EXISTS custom_packages_offers_something_check;
ALTER TABLE public.custom_packages
  ADD CONSTRAINT custom_packages_offers_something_check
  CHECK (posts_included > 0 OR videos_included > 0 OR credits_included > 0);
