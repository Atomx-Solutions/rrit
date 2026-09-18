-- PRC-10: an invoice for every purchase (package, annual package, upgrade,
-- credit top-up). Invoices are immutable once issued; corrections are credit
-- notes that reference the original invoice.

-- Seller details and VAT are configuration. VAT stays 0 until the accountant
-- confirms whether it applies; prices are VAT-inclusive totals, so changing the
-- rate changes the net/VAT split, never what the customer pays.
CREATE TABLE invoice_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  number_prefix text NOT NULL DEFAULT 'RRIT' CHECK (number_prefix ~ '^[A-Z0-9]{2,12}$'),
  seller_name text NOT NULL DEFAULT 'Rrit',
  seller_address text NOT NULL DEFAULT '',
  seller_fiscal_number text NOT NULL DEFAULT '',
  vat_rate_basis_points integer NOT NULL DEFAULT 0 CHECK (vat_rate_basis_points BETWEEN 0 AND 10000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO invoice_settings (singleton) VALUES (true);

-- The customer's invoicing details. Each invoice keeps its own snapshot, so
-- editing these later never changes an issued invoice.
CREATE TABLE organization_billing_details (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  legal_name text NOT NULL DEFAULT '' CHECK (length(legal_name) <= 160),
  address text NOT NULL DEFAULT '' CHECK (length(address) <= 240),
  city text NOT NULL DEFAULT '' CHECK (length(city) <= 120),
  country text NOT NULL DEFAULT '' CHECK (length(country) <= 120),
  fiscal_number text NOT NULL DEFAULT '' CHECK (length(fiscal_number) <= 40),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One counter row per year. It is incremented inside the purchase
-- transaction, so a rolled-back purchase also rolls back its number and the
-- sequence has no gaps.
CREATE TABLE invoice_sequences (
  year integer PRIMARY KEY CHECK (year BETWEEN 2000 AND 9999),
  last_number integer NOT NULL CHECK (last_number >= 0)
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  number text NOT NULL UNIQUE,
  year integer NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  kind text NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'credit_note')),
  credited_invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  seller jsonb NOT NULL,
  buyer jsonb NOT NULL,
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) > 0),
  subtotal_cents integer NOT NULL,
  vat_rate_basis_points integer NOT NULL CHECK (vat_rate_basis_points BETWEEN 0 AND 10000),
  vat_cents integer NOT NULL,
  total_cents integer NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('subscription_activation', 'subscription_upgrade', 'credit_top_up', 'credit_note')),
  source_reference text NOT NULL,
  UNIQUE (year, sequence),
  UNIQUE (organization_id, source_type, source_reference),
  CHECK (subtotal_cents + vat_cents = total_cents),
  CHECK ((kind = 'invoice' AND total_cents > 0 AND credited_invoice_id IS NULL)
      OR (kind = 'credit_note' AND total_cents < 0 AND credited_invoice_id IS NOT NULL))
);
CREATE INDEX invoices_organization_issued ON invoices (organization_id, issued_at DESC, sequence DESC);

CREATE OR REPLACE FUNCTION app.reject_invoice_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Invoices are immutable; issue a credit note instead.';
END
$$;
CREATE TRIGGER invoices_immutable
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.reject_invoice_change();

-- The counter is global across tenants, so tenant roles never touch the table
-- directly: this definer function hands out the next number of a year.
CREATE OR REPLACE FUNCTION app.next_invoice_sequence(invoice_year integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  invoice_schema text := pg_catalog.current_schema();
  next_number integer;
BEGIN
  IF invoice_schema IS NULL OR (
    invoice_schema <> 'public'
    AND invoice_schema !~ '^rrit_test_[a-f0-9]{32}$'
  ) THEN
    RAISE EXCEPTION 'Unsupported invoice schema';
  END IF;

  EXECUTE pg_catalog.format(
    'INSERT INTO %I.invoice_sequences AS s (year, last_number) VALUES ($1, 1)
       ON CONFLICT (year) DO UPDATE SET last_number = s.last_number + 1
       RETURNING last_number',
    invoice_schema
  ) INTO next_number USING invoice_year;
  RETURN next_number;
END
$function$;
REVOKE ALL ON FUNCTION app.next_invoice_sequence(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.next_invoice_sequence(integer) TO app_runtime;

ALTER TABLE invoice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_billing_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON invoice_settings TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON organization_billing_details TO app_runtime;
GRANT SELECT, INSERT ON invoices TO app_runtime;

CREATE POLICY invoice_settings_runtime_read ON invoice_settings FOR SELECT TO app_runtime USING (true);
CREATE POLICY organization_billing_details_runtime_tenant ON organization_billing_details FOR ALL TO app_runtime
  USING (organization_id = app.current_organization_id())
  WITH CHECK (organization_id = app.current_organization_id());
CREATE POLICY invoices_runtime_read ON invoices FOR SELECT TO app_runtime
  USING (organization_id = app.current_organization_id());
CREATE POLICY invoices_runtime_insert ON invoices FOR INSERT TO app_runtime
  WITH CHECK (organization_id = app.current_organization_id());
