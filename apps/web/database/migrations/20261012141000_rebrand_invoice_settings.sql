-- Rebrand future invoice defaults. Existing issued invoice numbers remain immutable.
ALTER TABLE invoice_settings
  ALTER COLUMN number_prefix SET DEFAULT 'FRAMIC',
  ALTER COLUMN seller_name SET DEFAULT 'Framic';

UPDATE invoice_settings
SET number_prefix = 'FRAMIC',
    seller_name = 'Framic'
WHERE singleton = true;
