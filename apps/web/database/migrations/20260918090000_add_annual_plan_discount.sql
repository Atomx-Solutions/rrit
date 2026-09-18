-- Annual prices are calculated from the monthly plan price for twelve months,
-- then discounted. Keeping the percentage on each plan lets commercial terms
-- change without a deployment.
ALTER TABLE plans
  ADD COLUMN annual_discount_percent integer NOT NULL DEFAULT 15
  CHECK (annual_discount_percent BETWEEN 0 AND 100);

UPDATE plans
SET annual_discount_percent = 0
WHERE is_trial;
