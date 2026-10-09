-- Preserve the platform ledger in EUR while invoices may be issued in CHF.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS base_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS base_subtotal_cents integer,
  ADD COLUMN IF NOT EXISTS base_vat_cents integer,
  ADD COLUMN IF NOT EXISTS base_total_cents integer,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8),
  ADD COLUMN IF NOT EXISTS exchange_rate_date date;

CREATE OR REPLACE FUNCTION public.set_invoice_workspace_currency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $function$
DECLARE
  selected_currency text;
  rate numeric := COALESCE(NULLIF(current_setting('app.eur_chf_rate', true), '')::numeric, 0.93);
  line jsonb; converted_lines jsonb := '[]'::jsonb;
BEGIN
  SELECT CASE WHEN state->'preferences'->>'currency' = 'CHF' THEN 'CHF' ELSE 'EUR' END
    INTO selected_currency FROM public.businesses WHERE id = NEW.organization_id;
  NEW.currency := COALESCE(selected_currency, 'EUR');
  NEW.base_currency := 'EUR';
  NEW.base_subtotal_cents := NEW.subtotal_cents;
  NEW.base_vat_cents := NEW.vat_cents;
  NEW.base_total_cents := NEW.total_cents;
  NEW.exchange_rate := CASE WHEN NEW.currency = 'CHF' THEN rate ELSE 1 END;
  NEW.exchange_rate_date := CURRENT_DATE;
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
END $function$;
