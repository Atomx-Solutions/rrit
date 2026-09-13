ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS resource_id text,
  ADD COLUMN IF NOT EXISTS result text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

UPDATE public.audit_events
SET organization_id = COALESCE(organization_id, business_id),
    resource_type = COALESCE(resource_type, split_part(action, '.', 1)),
    resource_id = COALESCE(resource_id, business_id::text),
    result = COALESCE(result, 'succeeded'),
    metadata = COALESCE(metadata, '{}'::jsonb)
WHERE organization_id IS NULL
   OR resource_type IS NULL
   OR resource_id IS NULL
   OR result IS NULL
   OR metadata IS NULL;

ALTER TABLE public.audit_events
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN resource_type SET NOT NULL,
  ALTER COLUMN resource_id SET NOT NULL,
  ALTER COLUMN result SET NOT NULL,
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN metadata SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_events'::regclass
      AND conname = 'audit_events_business_organization_match'
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_business_organization_match
      CHECK (organization_id = business_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_events'::regclass
      AND conname = 'audit_events_resource_type_check'
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_resource_type_check
      CHECK (resource_type ~ '^[a-z][a-z0-9_]{0,63}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_events'::regclass
      AND conname = 'audit_events_resource_id_check'
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_resource_id_check
      CHECK (length(trim(resource_id)) BETWEEN 1 AND 200);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_events'::regclass
      AND conname = 'audit_events_result_check'
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_result_check
      CHECK (result IN ('succeeded', 'failed', 'denied', 'cancelled'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_events'::regclass
      AND conname = 'audit_events_metadata_object_check'
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_metadata_object_check
      CHECK (jsonb_typeof(metadata) = 'object');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS audit_events_organization_created
  ON public.audit_events (organization_id, created_at DESC, id DESC);
