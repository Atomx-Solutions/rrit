-- Paddle endpoints run with the application runtime role. The payment order
-- and webhook event tables are intentionally not public, but the server must
-- be able to read/write them inside its authenticated transaction.
GRANT SELECT, INSERT, UPDATE ON TABLE public.paddle_payment_orders TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.paddle_webhook_events TO app_runtime;
