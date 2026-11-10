-- "Edit with AI" on a photo is queued the way a video render is: the request
-- only records the edit as 'queued' and a planner run claims it under a lease,
-- so only IMAGE_EDIT_CONCURRENCY edits (and IMAGE_EDIT_CONCURRENCY_PER_BUSINESS
-- for one business) call the image model at once.
CREATE TABLE public.image_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  instruction text NOT NULL,
  content_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'editing', 'ready', 'failed')),
  failure_reason text,
  lease_owner uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX image_edits_post ON public.image_edits(post_id, created_at DESC);
CREATE INDEX image_edits_queue ON public.image_edits(created_at)
  WHERE status IN ('queued', 'editing');
-- One edit at a time for a post, so a second click cannot pay for a second image.
CREATE UNIQUE INDEX image_edits_one_active ON public.image_edits(post_id)
  WHERE status IN ('queued', 'editing');

GRANT SELECT, INSERT, UPDATE ON public.image_edits TO app_runtime;
ALTER TABLE public.image_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY image_edits_tenant_access ON public.image_edits FOR ALL TO app_runtime
  USING (business_id = app.current_organization_id()) WITH CHECK (business_id = app.current_organization_id());

-- The planner run claims queued edits across businesses and leases them.
GRANT SELECT ON public.image_edits TO rrit_worker;
GRANT UPDATE (status, failure_reason, completed_at, lease_owner, lease_until) ON public.image_edits TO rrit_worker;
CREATE POLICY image_edits_worker_read ON public.image_edits
  FOR SELECT TO rrit_worker USING (true);
CREATE POLICY image_edits_worker_claim ON public.image_edits
  FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);
