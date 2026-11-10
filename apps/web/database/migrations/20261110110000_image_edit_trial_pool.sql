-- Photo edits of trial businesses run in a pool of their own
-- (IMAGE_EDIT_TRIAL_CONCURRENCY), apart from paid businesses
-- (IMAGE_EDIT_CONCURRENCY), so trials can never take a paying customer's place.
-- Whether an edit is a trial edit is decided when it is queued.
ALTER TABLE public.image_edits ADD COLUMN trial boolean NOT NULL DEFAULT false;
