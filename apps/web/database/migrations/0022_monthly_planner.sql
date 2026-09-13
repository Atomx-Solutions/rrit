-- Monthly planning is editorial only. No publication job is created here.
CREATE TABLE monthly_planner_settings (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE monthly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','review','blocked','cancelled')),
  stage text NOT NULL DEFAULT 'research' CHECK (stage IN ('research','planning','content','complete')),
  target_count integer NOT NULL CHECK (target_count BETWEEN 1 AND 100),
  completed_count integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0 AND completed_count <= target_count),
  evidence jsonb NOT NULL,
  evidence_hash text NOT NULL,
  entitlement_snapshot jsonb NOT NULL,
  research jsonb,
  editorial_plan jsonb,
  error_code text,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, month),
  UNIQUE (id, business_id)
);
CREATE TABLE monthly_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  business_id uuid NOT NULL,
  stage_key text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  prompt_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved','completed','uncertain')),
  reserved_cost_micro_eur bigint NOT NULL CHECK (reserved_cost_micro_eur > 0),
  actual_cost_micro_eur bigint CHECK (actual_cost_micro_eur >= 0),
  result jsonb,
  provider_response_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (plan_id, stage_key),
  FOREIGN KEY (plan_id,business_id) REFERENCES monthly_plans(id,business_id) ON DELETE CASCADE
);
CREATE INDEX monthly_plans_queue ON monthly_plans(updated_at) WHERE status IN ('queued','running');
CREATE INDEX monthly_ai_runs_budget ON monthly_ai_runs(business_id,created_at);
ALTER TABLE posts ADD COLUMN monthly_plan_id uuid, ADD COLUMN monthly_slot integer;
ALTER TABLE posts ADD COLUMN quota_month date;
UPDATE posts SET quota_month = date_trunc('month',created_at AT TIME ZONE 'UTC')::date;
ALTER TABLE posts ALTER COLUMN quota_month SET NOT NULL;
ALTER TABLE posts ALTER COLUMN quota_month SET DEFAULT date_trunc('month',now() AT TIME ZONE 'UTC')::date;
CREATE INDEX posts_quota_month ON posts(business_id,quota_month);
ALTER TABLE posts ADD CONSTRAINT posts_monthly_plan_tenant
  FOREIGN KEY (monthly_plan_id,business_id) REFERENCES monthly_plans(id,business_id);
CREATE UNIQUE INDEX posts_monthly_slot ON posts(monthly_plan_id,monthly_slot) WHERE monthly_plan_id IS NOT NULL;
ALTER TABLE assets ADD COLUMN creative_provenance jsonb;
ALTER TABLE post_content_versions DROP CONSTRAINT post_content_versions_source_check;
ALTER TABLE post_content_versions ADD CONSTRAINT post_content_versions_source_check CHECK (source IN ('migration','editor','monthly_planner'));
DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['monthly_planner_settings','monthly_plans','monthly_ai_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation_name);
    EXECUTE format('CREATE POLICY tenant_access ON %I FOR ALL TO app_runtime USING (business_id = app.current_organization_id()) WITH CHECK (business_id = app.current_organization_id())',relation_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_runtime',relation_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rrit_worker') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO rrit_worker',relation_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rrit_worker') THEN
    GRANT SELECT ON ai_cost_ledger TO rrit_worker;
  END IF;
END $$;
