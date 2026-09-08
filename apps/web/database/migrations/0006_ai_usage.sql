CREATE TABLE ai_daily_usage (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  usage_day date NOT NULL,
  requests integer NOT NULL CHECK(requests > 0),
  PRIMARY KEY(business_id,usage_day)
);
CREATE TABLE ai_generations (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','completed','failed')),
  output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ai_generations_business ON ai_generations(business_id,created_at DESC);
