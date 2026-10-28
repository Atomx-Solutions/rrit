-- Offers accept every currency the business brain schema allows; CHF was
-- missing, so the editor's default currency was rejected on insert.
ALTER TABLE brand_offers DROP CONSTRAINT IF EXISTS brand_offers_currency_check;
ALTER TABLE brand_offers ADD CONSTRAINT brand_offers_currency_check CHECK (currency IN ('EUR', 'CHF', 'ALL'));
