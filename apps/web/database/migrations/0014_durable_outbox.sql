CREATE TABLE outbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL CHECK (topic ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  deduplication_key text NOT NULL CHECK (length(deduplication_key) BETWEEN 1 AND 200),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'dead')),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (topic, deduplication_key),
  CHECK ((status = 'processing') = (locked_at IS NOT NULL)),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX outbox_messages_due
  ON outbox_messages (available_at, created_at, id)
  WHERE status = 'pending';
CREATE INDEX outbox_messages_stale
  ON outbox_messages (locked_at, id)
  WHERE status = 'processing';

CREATE TABLE outbox_consumptions (
  message_id uuid NOT NULL REFERENCES outbox_messages(id) ON DELETE CASCADE,
  consumer text NOT NULL CHECK (consumer ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, consumer)
);
