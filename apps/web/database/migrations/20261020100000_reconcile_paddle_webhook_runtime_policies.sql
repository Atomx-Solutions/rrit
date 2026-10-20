-- Earlier installations may already have recorded the initial Paddle
-- migrations while retaining a restrictive webhook INSERT policy. Recreate
-- both runtime policies so verified provider events can be recorded and then
-- marked as processed in the same transaction.
GRANT SELECT, INSERT, UPDATE ON TABLE public.paddle_webhook_events TO app_runtime;

DROP POLICY IF EXISTS paddle_webhook_events_runtime_insert
  ON public.paddle_webhook_events;
CREATE POLICY paddle_webhook_events_runtime_insert
  ON public.paddle_webhook_events
  FOR INSERT TO app_runtime
  WITH CHECK (true);

DROP POLICY IF EXISTS paddle_webhook_events_runtime_update
  ON public.paddle_webhook_events;
CREATE POLICY paddle_webhook_events_runtime_update
  ON public.paddle_webhook_events
  FOR UPDATE TO app_runtime
  USING (true)
  WITH CHECK (true);
