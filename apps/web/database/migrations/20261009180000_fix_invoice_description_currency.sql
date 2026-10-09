-- Do not leave the EUR source unit price in a CHF invoice description. The
-- numeric unit and total columns already contain the converted CHF amounts.
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
    INTO selected_currency FROM public.businesses WHERE id = NEW.organization_id;
  NEW.currency := COALESCE(selected_currency, 'EUR');
  IF NEW.currency = 'CHF' THEN
    NEW.subtotal_cents := round(NEW.subtotal_cents * rate)::integer;
    NEW.vat_cents := round(NEW.vat_cents * rate)::integer;
    NEW.total_cents := NEW.subtotal_cents + NEW.vat_cents;
    FOR line IN SELECT value FROM jsonb_array_elements(NEW.lines) LOOP
      line := jsonb_set(line, '{unitPriceCents}', to_jsonb(round((line->>'unitPriceCents')::numeric * rate)::integer));
      line := jsonb_set(line, '{totalCents}', to_jsonb(round((line->>'totalCents')::numeric * rate)::integer));
      line := jsonb_set(line, '{description}', to_jsonb(regexp_replace(line->>'description', ' [0-9]+(\.[0-9]+)? EUR', '', 'g')));
      converted_lines := converted_lines || jsonb_build_array(line);
    END LOOP;
    NEW.lines := converted_lines;
  END IF;
  RETURN NEW;
END
$function$;
