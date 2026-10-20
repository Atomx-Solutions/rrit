-- The webhook inserts with RETURNING event_id and later updates the same row.
-- PostgreSQL applies SELECT RLS to rows read by RETURNING and UPDATE, so the
-- existing INSERT and UPDATE policies alone still reject verified events.
DROP POLICY IF EXISTS paddle_webhook_events_runtime_select
  ON public.paddle_webhook_events;
CREATE POLICY paddle_webhook_events_runtime_select
  ON public.paddle_webhook_events
  FOR SELECT TO app_runtime
  USING (true);
