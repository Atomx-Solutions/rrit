-- Keep the database-owned Free Trial package aligned with its published
-- three-post allowance. Trial enforcement reads this package directly.
UPDATE plans
SET posts_per_month = 3,
    updated_at = now()
WHERE code = 'free-trial'
  AND posts_per_month <> 3;
