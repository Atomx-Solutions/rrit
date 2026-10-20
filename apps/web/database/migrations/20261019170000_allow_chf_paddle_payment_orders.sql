-- Admin-negotiated offers may be denominated in the platform's CHF currency.
-- Keep the order record aligned with the offer sent to Paddle.
ALTER TABLE public.paddle_payment_orders
  DROP CONSTRAINT IF EXISTS paddle_payment_orders_currency_check;

ALTER TABLE public.paddle_payment_orders
  ADD CONSTRAINT paddle_payment_orders_currency_check
  CHECK (currency IN ('EUR', 'CHF'));
