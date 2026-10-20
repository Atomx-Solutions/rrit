-- Payment orders are tenant-owned. The authenticated app transaction already
-- sets the current organization, so keep RLS enabled and scope every write.
CREATE POLICY paddle_payment_orders_runtime_org
  ON public.paddle_payment_orders
  FOR ALL TO app_runtime
  USING (organization_id = app.current_organization_id())
  WITH CHECK (organization_id = app.current_organization_id());

-- Webhooks have no end-user tenant context. They are authenticated by Paddle's
-- signature in the server handler, so allow the runtime role to append events.
CREATE POLICY paddle_webhook_events_runtime_insert
  ON public.paddle_webhook_events
  FOR INSERT TO app_runtime
  WITH CHECK (true);
