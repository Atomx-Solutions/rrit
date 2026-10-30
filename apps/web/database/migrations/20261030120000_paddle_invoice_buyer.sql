-- The buyer on a Paddle invoice now comes from Paddle's checkout (customer,
-- address and business), because customers no longer keep billing details in
-- the app. Without a buyer from Paddle it falls back to the organization.
DROP FUNCTION IF EXISTS app.issue_paddle_invoice(text);

CREATE OR REPLACE FUNCTION app.issue_paddle_invoice(p_transaction_id text, p_buyer jsonb DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- public first: app.next_invoice_sequence reads current_schema() and refuses
-- to number invoices when that reports pg_catalog.
SET search_path = public, pg_catalog
AS $function$
DECLARE
  tx jsonb;
  payment_order public.paddle_payment_orders%ROWTYPE;
  settings public.invoice_settings%ROWTYPE;
  buyer jsonb;
  invoice_source text;
  issued timestamptz;
  year integer;
  seq integer;
  subtotal integer;
  discount integer;
  vat integer;
  lines jsonb;
  stored_currency text;
  existing uuid;
  new_id uuid;
BEGIN
  SELECT payload->'data' INTO tx
    FROM public.paddle_webhook_events
   WHERE payload->'data'->>'id' = p_transaction_id
     AND event_type IN ('transaction.completed', 'transaction.paid')
   ORDER BY (event_type = 'transaction.completed') DESC, occurred_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paddle transaction not stored: %', p_transaction_id;
  END IF;

  SELECT * INTO payment_order
    FROM public.paddle_payment_orders
   WHERE id = (tx->'custom_data'->>'orderId')::uuid;
  IF NOT FOUND OR payment_order.status <> 'paid' THEN
    RETURN NULL;
  END IF;

  invoice_source := CASE
    WHEN payment_order.posts_included = 0 AND payment_order.videos_included = 0 THEN 'credit_top_up'
    WHEN payment_order.posts_included = 0 AND payment_order.credits_included = 0 THEN 'video_purchase'
    ELSE 'custom_package'
  END;

  -- One invoice per Paddle transaction: webhook retries and the backfill never
  -- issue a second one.
  SELECT id INTO existing FROM public.invoices
   WHERE organization_id = payment_order.organization_id
     AND source_type = invoice_source
     AND source_reference = p_transaction_id;
  IF FOUND THEN
    RETURN existing;
  END IF;

  SELECT * INTO settings FROM public.invoice_settings WHERE singleton = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice settings are not configured.';
  END IF;

  -- Paddle collects the buyer at checkout and the webhook passes it on; the
  -- organization's stored details remain for a backfill that has no buyer.
  SELECT COALESCE(p_buyer, pg_catalog.jsonb_build_object(
           'name', COALESCE(details.legal_name, organization.name),
           'address', COALESCE(details.address, ''), 'city', COALESCE(details.city, ''),
           'country', COALESCE(details.country, ''), 'fiscalNumber', COALESCE(details.fiscal_number, '')))
    INTO buyer
    FROM public.organizations AS organization
    LEFT JOIN public.organization_billing_details AS details ON details.organization_id = organization.id
   WHERE organization.id = payment_order.organization_id;

  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'description', item->'product'->>'name',
           'quantity', (item->>'quantity')::integer,
           'unitPriceCents', (item->'unit_totals'->>'subtotal')::integer,
           'totalCents', (item->'totals'->>'subtotal')::integer))
    INTO lines
    FROM pg_catalog.jsonb_array_elements(tx->'details'->'line_items') AS item;

  -- Paddle's subtotal is before discount; the discount becomes its own line so
  -- the lines still add up to the net amount that was taxed.
  discount := COALESCE((tx->'details'->'totals'->>'discount')::integer, 0);
  IF discount <> 0 THEN
    lines := COALESCE(lines, '[]'::jsonb) || pg_catalog.jsonb_build_object(
      'description', 'Discount', 'quantity', 1,
      'unitPriceCents', -discount, 'totalCents', -discount);
  END IF;
  subtotal := (tx->'details'->'totals'->>'subtotal')::integer - discount;
  vat := (tx->'details'->'totals'->>'tax')::integer;
  issued := COALESCE((tx->>'billed_at')::timestamptz, payment_order.paid_at, pg_catalog.now());
  year := pg_catalog.date_part('year', issued AT TIME ZONE 'UTC')::integer;
  seq := app.next_invoice_sequence(year);

  INSERT INTO public.invoices
    (organization_id, number, year, sequence, kind, issued_at, seller, buyer, lines,
     subtotal_cents, vat_rate_basis_points, vat_cents, total_cents, source_type, source_reference)
  VALUES (
    payment_order.organization_id,
    settings.number_prefix || '-' || year::text || '-' || pg_catalog.lpad(seq::text, 6, '0'),
    year, seq, 'invoice', issued,
    pg_catalog.jsonb_build_object(
      'name', settings.seller_name,
      'address', settings.seller_address,
      'fiscalNumber', settings.seller_fiscal_number
    ),
    buyer, COALESCE(lines, '[]'::jsonb),
    subtotal,
    COALESCE(pg_catalog.round((tx->'details'->'line_items'->0->>'tax_rate')::numeric * 10000)::integer, 0),
    vat, (tx->'details'->'totals'->>'grand_total')::integer,
    invoice_source, p_transaction_id
  )
  RETURNING id, currency INTO new_id, stored_currency;

  -- The invoice currency is the platform currency (set by trigger); amounts
  -- are Paddle's. If the two disagree the record would be wrong, so refuse.
  IF stored_currency <> tx->>'currency_code' THEN
    RAISE EXCEPTION 'Paddle charged % but invoices are kept in %', tx->>'currency_code', stored_currency;
  END IF;

  -- Paddle already collected it: the invoice opens paid, never overdue.
  UPDATE public.invoice_payments
     SET status = 'paid',
         paid_at = COALESCE((tx->'payments'->0->>'captured_at')::timestamptz, issued),
         method = CASE WHEN tx->'payments'->0->'method_details'->>'type' = 'card' THEN 'card' ELSE 'other' END,
         note = 'Paddle ' || COALESCE(tx->>'invoice_number', '') || ' · ' || p_transaction_id,
         updated_at = pg_catalog.now()
   WHERE invoice_id = new_id;

  RETURN new_id;
END
$function$;
REVOKE ALL ON FUNCTION app.issue_paddle_invoice(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.issue_paddle_invoice(text, jsonb) TO app_runtime;
