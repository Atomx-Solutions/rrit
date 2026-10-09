-- Convert the EUR commercial amounts when an invoice is created for a CHF
-- workspace. The stored invoice is then an immutable CHF snapshot.
CREATE OR REPLACE FUNCTION public.set_invoice_workspace_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  selected_currency text;
  rate numeric := COALESCE(NULLIF(current_setting('app.eur_chf_rate', true), '')::numeric, 0.93);
  converted_lines jsonb := '[]'::jsonb;
  line jsonb;
BEGIN
  SELECT CASE WHEN state->'preferences'->>'currency' = 'CHF' THEN 'CHF' ELSE 'EUR' END
    INTO selected_currency
    FROM public.businesses WHERE id = NEW.organization_id;
  NEW.currency := COALESCE(selected_currency, 'EUR');
  IF NEW.currency = 'CHF' THEN
    NEW.subtotal_cents := round(NEW.subtotal_cents * rate)::integer;
    NEW.vat_cents := round(NEW.vat_cents * rate)::integer;
    NEW.total_cents := NEW.subtotal_cents + NEW.vat_cents;
    FOR line IN SELECT value FROM jsonb_array_elements(NEW.lines) LOOP
      line := jsonb_set(line, '{unitPriceCents}', to_jsonb(round((line->>'unitPriceCents')::numeric * rate)::integer));
      line := jsonb_set(line, '{totalCents}', to_jsonb(round((line->>'totalCents')::numeric * rate)::integer));
      line := jsonb_set(line, '{description}', to_jsonb(replace(line->>'description', ' EUR', ' CHF')));
      converted_lines := converted_lines || jsonb_build_array(line);
    END LOOP;
    NEW.lines := converted_lines;
  END IF;
  RETURN NEW;
END
$function$;
