CREATE TABLE ai_cost_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL UNIQUE REFERENCES ai_generations(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved','committed','released')),
  estimated_input_tokens integer NOT NULL CHECK (estimated_input_tokens >= 0),
  reserved_output_tokens integer NOT NULL CHECK (reserved_output_tokens >= 0),
  actual_input_tokens integer CHECK (actual_input_tokens IS NULL OR actual_input_tokens >= 0),
  actual_output_tokens integer CHECK (actual_output_tokens IS NULL OR actual_output_tokens >= 0),
  reserved_cost_micro_eur bigint NOT NULL CHECK (reserved_cost_micro_eur >= 0),
  actual_cost_micro_eur bigint CHECK (actual_cost_micro_eur IS NULL OR actual_cost_micro_eur >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX ai_cost_business_created ON ai_cost_ledger(business_id,created_at DESC);
CREATE INDEX ai_cost_reserved ON ai_cost_ledger(created_at) WHERE status='reserved';
