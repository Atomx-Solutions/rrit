-- RRIT-SA-01: a superadmin can pause a subscription manually without
-- cancelling it. Existing rows keep their status; the pause columns stay NULL.
ALTER TABLE subscriptions
  DROP CONSTRAINT subscriptions_status_check,
  ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN (
      'trialing','active','past_due','cancelled','expired','paused'
    ));

ALTER TABLE subscriptions
  ADD COLUMN paused_at     timestamptz,
  ADD COLUMN paused_by     text,
  ADD COLUMN paused_reason text CHECK (length(paused_reason) <= 300);
