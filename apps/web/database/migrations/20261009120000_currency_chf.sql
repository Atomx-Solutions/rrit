-- Product billing now uses CHF. Keep EUR readable for existing workspace
-- preferences, while all new commercial records and defaults use CHF.

ALTER TABLE plans ALTER COLUMN currency SET DEFAULT 'CHF';
ALTER TABLE credit_pricing ALTER COLUMN currency SET DEFAULT 'CHF';
ALTER TABLE invoices ALTER COLUMN currency SET DEFAULT 'CHF';
ALTER TABLE custom_packages ALTER COLUMN currency SET DEFAULT 'CHF';

DO $$
DECLARE
  target_table text;
  constraint_name text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['plans', 'credit_pricing', 'invoices', 'custom_packages'] LOOP
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = target_table::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%currency%';
    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', target_table, constraint_name);
    END IF;
  END LOOP;
END $$;

ALTER TABLE plans ADD CONSTRAINT plans_currency_check CHECK (currency IN ('EUR', 'CHF'));
ALTER TABLE credit_pricing ADD CONSTRAINT credit_pricing_currency_check CHECK (currency IN ('EUR', 'CHF'));
ALTER TABLE invoices ADD CONSTRAINT invoices_currency_check CHECK (currency IN ('EUR', 'CHF'));
ALTER TABLE custom_packages ADD CONSTRAINT custom_packages_currency_check CHECK (currency IN ('EUR', 'CHF'));
