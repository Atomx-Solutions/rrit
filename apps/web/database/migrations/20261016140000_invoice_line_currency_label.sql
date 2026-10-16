-- Package invoice lines are written as "14 posts × 5.35 EUR" whatever the
-- platform currency, so a CHF invoice described its prices in euros. The
-- amounts are already in the invoice currency; only the label was wrong. The
-- trigger that stamps the currency now also names it in each line.
CREATE OR REPLACE FUNCTION public.set_invoice_workspace_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  selected_currency text;
  relabelled jsonb := '[]'::jsonb;
  line jsonb;
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

  IF NEW.currency <> 'EUR' AND pg_catalog.jsonb_typeof(NEW.lines) = 'array' THEN
    FOR line IN SELECT value FROM pg_catalog.jsonb_array_elements(NEW.lines) LOOP
      IF line ? 'description' THEN
        line := pg_catalog.jsonb_set(line, '{description}', pg_catalog.to_jsonb(
          pg_catalog.regexp_replace(line->>'description', '([0-9]) EUR\M', '\1 ' || NEW.currency, 'g')
        ));
      END IF;
      relabelled := relabelled || pg_catalog.jsonb_build_array(line);
    END LOOP;
    NEW.lines := relabelled;
  END IF;
  RETURN NEW;
END
$function$;
