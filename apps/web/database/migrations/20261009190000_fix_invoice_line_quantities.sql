-- Keep invoice rows mathematically correct for package/video quantities.
-- The package invoice functions historically stored quantity=1 and put the
-- package count in the description. Normalize those lines at the invoice
-- boundary so PDF and admin tables show Qty and unit price correctly.
CREATE OR REPLACE FUNCTION public.normalize_invoice_line_quantities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item jsonb;
  normalized jsonb := '[]'::jsonb;
  count_value integer;
  line_total bigint;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.lines, '[]'::jsonb))
  LOOP
    count_value := NULL;
    IF item->>'description' ~ '[0-9]+[[:space:]]+(videos?|posts?)' THEN
      count_value := substring(item->>'description' FROM '([0-9]+)[[:space:]]+(videos?|posts?)')::integer;
    END IF;

    IF count_value IS NOT NULL AND count_value > 0 THEN
      line_total := COALESCE((item->>'totalCents')::bigint, 0);
      item := jsonb_set(item, '{quantity}', to_jsonb(count_value), true);
      item := jsonb_set(item, '{unitPriceCents}', to_jsonb(ROUND(line_total::numeric / count_value)::bigint), true);
    END IF;
    normalized := normalized || jsonb_build_array(item);
  END LOOP;
  NEW.lines := normalized;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_invoice_line_quantities ON public.invoices;
CREATE TRIGGER normalize_invoice_line_quantities
BEFORE INSERT OR UPDATE OF lines ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.normalize_invoice_line_quantities();

