-- Store the workspace currency on each invoice at creation time. Admin prices
-- remain EUR, while the invoice snapshot follows the customer's setting.
CREATE OR REPLACE FUNCTION public.set_invoice_workspace_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE selected_currency text;
BEGIN
  SELECT CASE WHEN state->'preferences'->>'currency' = 'CHF' THEN 'CHF' ELSE 'EUR' END
    INTO selected_currency
    FROM public.businesses
   WHERE id = NEW.organization_id;
  NEW.currency := COALESCE(selected_currency, 'EUR');
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS invoices_workspace_currency ON public.invoices;
CREATE TRIGGER invoices_workspace_currency
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_workspace_currency();
