-- The webhook records the event first and marks it processed after the payment
-- transition. INSERT-only RLS therefore caused every successful payment to end
-- with a 500 response and left the package offer pending.
DROP POLICY IF EXISTS paddle_webhook_events_runtime_update ON public.paddle_webhook_events;
CREATE POLICY paddle_webhook_events_runtime_update
  ON public.paddle_webhook_events
  FOR UPDATE TO app_runtime
  USING (true)
  WITH CHECK (true);
