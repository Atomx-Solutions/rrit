-- Each plan carries its own lease, so several plans can advance at once
-- instead of every business waiting behind one planner-wide lease. The owner
-- fences every write a planner run makes: a run that lost its lease changes
-- nothing. A lease always outlives the function that holds it, so an expired
-- lease means its run has stopped.
ALTER TABLE monthly_plans
  ADD COLUMN lease_owner uuid,
  ADD COLUMN lease_until timestamptz;

CREATE INDEX monthly_plans_active_leases ON monthly_plans(lease_until)
  WHERE lease_until IS NOT NULL;
