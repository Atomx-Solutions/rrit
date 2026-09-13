-- A database lease survives connection-pool churn safely and expires after a
-- crashed worker. Session advisory locks can remain attached to an idle
-- Supavisor backend after the application connection disappears.
ALTER TABLE worker_heartbeats ADD COLUMN IF NOT EXISTS lease_owner uuid;
ALTER TABLE worker_heartbeats ADD COLUMN IF NOT EXISTS lease_until timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='worker_heartbeats'::regclass
      AND conname='worker_heartbeats_lease_pair_check'
  ) THEN
    ALTER TABLE worker_heartbeats ADD CONSTRAINT worker_heartbeats_lease_pair_check
      CHECK ((lease_owner IS NULL) = (lease_until IS NULL));
  END IF;
END
$$;
