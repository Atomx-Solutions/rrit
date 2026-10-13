-- Package prices are now entered in the central superadmin currency. The
-- former workspace-currency trigger treated every incoming amount as EUR and
-- converted CHF packages once again (CHF 99.00 became CHF 92.07 at 0.93).
-- Store the selected platform currency as the invoice snapshot, unchanged.
CREATE OR REPLACE FUNCTION public.set_invoice_workspace_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  selected_currency text;
BEGIN
  SELECT CASE WHEN package_currency = 'EUR' THEN 'EUR' ELSE 'CHF' END
    INTO selected_currency
    FROM public.platform_settings
   WHERE singleton;

  NEW.currency := COALESCE(selected_currency, 'CHF');
  NEW.base_currency := NEW.currency;
  NEW.base_subtotal_cents := NEW.subtotal_cents;
  NEW.base_vat_cents := NEW.vat_cents;
  NEW.base_total_cents := NEW.total_cents;
  NEW.exchange_rate := 1;
  NEW.exchange_rate_date := CURRENT_DATE;
  RETURN NEW;
END
$function$;

-- Existing issued invoices intentionally remain immutable. A correction for
-- one of those documents must be represented by a credit note, not an UPDATE.
