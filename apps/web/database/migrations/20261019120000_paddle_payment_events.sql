-- Paddle integration foundation. This records verified provider events only;
-- existing request/proposal/package activation remains unchanged until the
-- checkout and payment-order flow is enabled.
CREATE TABLE paddle_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX paddle_webhook_events_type_created
  ON paddle_webhook_events(event_type, created_at DESC);

ALTER TABLE paddle_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON paddle_webhook_events FROM PUBLIC;
