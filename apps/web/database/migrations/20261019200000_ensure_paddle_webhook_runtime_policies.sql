-- Production may already have recorded the earlier Paddle migrations while
-- missing the webhook policies. Make the runtime contract self-healing.
GRANT SELECT, INSERT, UPDATE ON TABLE public.paddle_webhook_events TO app_runtime;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'paddle_webhook_events'
       AND policyname = 'paddle_webhook_events_runtime_insert'
  ) THEN
    CREATE POLICY paddle_webhook_events_runtime_insert
      ON public.paddle_webhook_events
      FOR INSERT TO app_runtime
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'paddle_webhook_events'
       AND policyname = 'paddle_webhook_events_runtime_update'
  ) THEN
    CREATE POLICY paddle_webhook_events_runtime_update
      ON public.paddle_webhook_events
      FOR UPDATE TO app_runtime
      USING (true)
      WITH CHECK (true);
  END IF;
END
$do$;
