-- A video is rendered from a queue instead of inside the request or planner
-- step that asked for it. A render waits as 'queued' with its credits already
-- held, and a planner run claims it with a lease the way it claims a plan:
-- the lease always outlives the function holding it, and fences every write.

DO $$
DECLARE
  constraint_name text;
BEGIN
  -- The status check was created inline on the table's first name, so its
  -- name depends on which migration created the table.
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.video_renders'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.video_renders DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.video_renders
  ADD CONSTRAINT video_renders_status_check
    CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
  -- Who asked for the render; the run acts for them.
  ADD COLUMN requested_by uuid,
  -- What is held for the render, so a render that was stopped can give it back.
  ADD COLUMN reserved_credits integer,
  ADD COLUMN lease_owner uuid,
  ADD COLUMN lease_until timestamptz;

-- One render at a time for a post, so a second click cannot pay for a second
-- video. Renders started before the queue carry no lease and are left out.
CREATE UNIQUE INDEX video_renders_one_active ON public.video_renders(post_id)
  WHERE status = 'queued' OR (status = 'rendering' AND lease_owner IS NOT NULL);

CREATE INDEX video_renders_queue ON public.video_renders(created_at)
  WHERE status IN ('queued', 'rendering');

-- The planner run claims queued renders across businesses and leases them.
GRANT UPDATE (status, lease_owner, lease_until) ON public.video_renders TO rrit_worker;
CREATE POLICY video_renders_worker_claim ON public.video_renders
  FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);
