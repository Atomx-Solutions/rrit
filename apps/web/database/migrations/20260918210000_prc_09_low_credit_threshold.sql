-- PRC-09: the low-credit reminder threshold is configuration, not code.
-- The dashboard shows a reminder when a customer's spendable credits fall
-- below this value.
ALTER TABLE credit_pricing
  ADD COLUMN low_credit_threshold integer NOT NULL DEFAULT 100 CHECK (low_credit_threshold >= 0);
