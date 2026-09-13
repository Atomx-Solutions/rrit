import pg from 'pg'

const connectionString = process.env.WORKER_DATABASE_URL
if (!connectionString)
  throw new Error('Set WORKER_DATABASE_URL to a restricted login that is a member of rrit_worker.')

const client = new pg.Client({ connectionString })
const requiredPolicies = [
  'rrit_worker_monthly_planner_settings_read',
  'rrit_worker_monthly_planner_settings_insert',
  'rrit_worker_monthly_planner_settings_update',
  'rrit_worker_monthly_plans_read',
  'rrit_worker_monthly_plans_insert',
  'rrit_worker_monthly_plans_update',
  'rrit_worker_monthly_ai_runs_read',
  'rrit_worker_monthly_ai_runs_insert',
  'rrit_worker_monthly_ai_runs_update',
  'rrit_worker_meta_connections_read',
  'rrit_worker_meta_connections_update',
  'rrit_worker_posts_update',
  'rrit_worker_post_validations_read',
  'rrit_worker_publication_jobs_read',
  'rrit_worker_publication_jobs_update',
  'rrit_worker_publication_attempts_read',
  'rrit_worker_publication_attempts_insert',
  'rrit_worker_meta_oauth_states_delete',
  'rrit_worker_ai_daily_usage_delete',
  'rrit_worker_ai_generations_delete',
  'rrit_worker_trial_claims_delete',
  'rrit_worker_post_validations_delete',
  'rrit_worker_social_posts_delete',
  'rrit_worker_app_settings_read',
  'rrit_worker_worker_heartbeats_read',
  'rrit_worker_worker_heartbeats_insert',
  'rrit_worker_worker_heartbeats_update',
  'rrit_worker_maintenance_runs_read',
  'rrit_worker_maintenance_runs_insert',
  'rrit_worker_maintenance_runs_update',
  'rrit_worker_outbox_messages_read',
  'rrit_worker_outbox_messages_update',
  'rrit_worker_outbox_consumptions_read',
  'rrit_worker_outbox_consumptions_insert',
]
const operationalTables = [
  'schema_migrations',
  'post_templates',
  'app_settings',
  'plan_catalog',
  'worker_heartbeats',
  'maintenance_runs',
  'outbox_messages',
  'outbox_consumptions',
  'meta_connections',
  'posts',
  'post_validations',
  'publication_jobs',
  'publication_attempts',
  'meta_oauth_states',
  'ai_daily_usage',
  'ai_generations',
  'trial_claims',
  'social_posts',
]

try {
  await client.connect()
  const roleResult = await client.query(`
    SELECT
      current_user AS current_role,
      role.rolsuper AS is_superuser,
      role.rolbypassrls AS bypasses_rls,
      pg_has_role(current_user, 'rrit_worker', 'MEMBER') AS is_worker_member,
      pg_has_role(current_user, 'app_runtime', 'MEMBER') AS is_runtime_member,
      has_table_privilege(current_user, 'monthly_planner_settings', 'SELECT')
        AND has_table_privilege(current_user, 'monthly_planner_settings', 'INSERT')
        AND has_table_privilege(current_user, 'monthly_planner_settings', 'UPDATE') AS settings_access,
      has_table_privilege(current_user, 'monthly_plans', 'SELECT')
        AND has_table_privilege(current_user, 'monthly_plans', 'INSERT')
        AND has_table_privilege(current_user, 'monthly_plans', 'UPDATE') AS plans_access,
      has_table_privilege(current_user, 'monthly_ai_runs', 'SELECT')
        AND has_table_privilege(current_user, 'monthly_ai_runs', 'INSERT')
        AND has_table_privilege(current_user, 'monthly_ai_runs', 'UPDATE') AS runs_access,
      has_table_privilege(current_user, 'monthly_planner_settings', 'DELETE') AS settings_delete,
      has_table_privilege(current_user, 'monthly_plans', 'DELETE') AS plans_delete,
      has_table_privilege(current_user, 'monthly_ai_runs', 'DELETE') AS runs_delete,
      has_function_privilege(current_user, 'app.audit_metadata_is_safe(jsonb)', 'EXECUTE')
        AS audit_validation_access,
      has_table_privilege(current_user, 'meta_connections', 'SELECT')
        AND has_table_privilege(current_user, 'meta_connections', 'UPDATE')
        AND has_table_privilege(current_user, 'posts', 'UPDATE')
        AND has_table_privilege(current_user, 'post_validations', 'SELECT')
        AND has_table_privilege(current_user, 'publication_jobs', 'SELECT')
        AND has_table_privilege(current_user, 'publication_jobs', 'UPDATE')
        AND has_table_privilege(current_user, 'publication_attempts', 'SELECT')
        AND has_table_privilege(current_user, 'publication_attempts', 'INSERT')
        AS publisher_access,
      has_table_privilege(current_user, 'meta_oauth_states', 'DELETE')
        AND has_table_privilege(current_user, 'ai_daily_usage', 'DELETE')
        AND has_table_privilege(current_user, 'ai_generations', 'DELETE')
        AND has_table_privilege(current_user, 'trial_claims', 'DELETE')
        AND has_table_privilege(current_user, 'post_validations', 'DELETE')
        AND has_table_privilege(current_user, 'social_posts', 'DELETE')
        AS maintenance_access,
      has_table_privilege(current_user, 'app_settings', 'SELECT')
        AND NOT has_table_privilege(current_user, 'app_settings', 'INSERT')
        AND NOT has_table_privilege(current_user, 'app_settings', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'app_settings', 'DELETE')
        AND has_table_privilege(current_user, 'worker_heartbeats', 'SELECT')
        AND has_table_privilege(current_user, 'worker_heartbeats', 'INSERT')
        AND has_table_privilege(current_user, 'worker_heartbeats', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'worker_heartbeats', 'DELETE')
        AND has_table_privilege(current_user, 'maintenance_runs', 'SELECT')
        AND has_table_privilege(current_user, 'maintenance_runs', 'INSERT')
        AND has_table_privilege(current_user, 'maintenance_runs', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'maintenance_runs', 'DELETE')
        AS safe_operational_access,
      has_table_privilege(current_user, 'outbox_messages', 'SELECT')
        AND has_table_privilege(current_user, 'outbox_messages', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'outbox_messages', 'INSERT')
        AND NOT has_table_privilege(current_user, 'outbox_messages', 'DELETE')
        AND has_table_privilege(current_user, 'outbox_consumptions', 'SELECT')
        AND has_table_privilege(current_user, 'outbox_consumptions', 'INSERT')
        AND NOT has_table_privilege(current_user, 'outbox_consumptions', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'outbox_consumptions', 'DELETE')
        AS safe_outbox_access,
      row_security_active('monthly_planner_settings') AS settings_rls_active,
      row_security_active('monthly_plans') AS plans_rls_active,
      row_security_active('monthly_ai_runs') AS runs_rls_active,
      row_security_active('meta_connections')
        AND row_security_active('posts')
        AND row_security_active('post_validations')
        AND row_security_active('publication_jobs')
        AND row_security_active('publication_attempts')
        AND row_security_active('meta_oauth_states')
        AND row_security_active('ai_daily_usage')
        AND row_security_active('ai_generations')
        AND row_security_active('trial_claims')
        AND row_security_active('social_posts') AS operations_rls_active
    FROM pg_roles AS role
    WHERE role.rolname = current_user
  `)
  const role = roleResult.rows[0]
  if (!role) throw new Error('Could not determine the active planner worker role.')
  const policies = await client.query(
    `SELECT policyname FROM pg_policies
      WHERE schemaname = current_schema() AND policyname = ANY($1::text[])`,
    [requiredPolicies],
  )
  const foundPolicies = new Set(policies.rows.map((row) => row.policyname))
  const missingPolicies = requiredPolicies.filter((name) => !foundPolicies.has(name))
  const operationRls = await client.query(
    `SELECT table_name, row_security_active(to_regclass(table_name)) AS rls_active
     FROM unnest($1::text[]) AS table_name`,
    [operationalTables],
  )
  const inactiveOperationalTables = operationRls.rows
    .filter((table) => !table.rls_active)
    .map((table) => table.table_name)

  const failedChecks = [
    role.is_superuser && 'is_superuser',
    role.bypasses_rls && 'bypasses_rls',
    !role.is_worker_member && 'missing_worker_membership',
    role.is_runtime_member && 'unexpected_runtime_membership',
    !role.settings_access && 'missing_settings_access',
    !role.plans_access && 'missing_plans_access',
    !role.runs_access && 'missing_runs_access',
    !role.publisher_access && 'missing_publisher_access',
    !role.maintenance_access && 'missing_maintenance_access',
    !role.safe_operational_access && 'unsafe_operational_access',
    !role.safe_outbox_access && 'unsafe_outbox_access',
    role.settings_delete && 'unexpected_settings_delete',
    role.plans_delete && 'unexpected_plans_delete',
    role.runs_delete && 'unexpected_runs_delete',
    !role.audit_validation_access && 'missing_audit_validation_access',
    !role.settings_rls_active && 'settings_rls_inactive',
    !role.plans_rls_active && 'plans_rls_inactive',
    !role.runs_rls_active && 'runs_rls_inactive',
    ...inactiveOperationalTables.map((table) => `rls_inactive:${table}`),
    ...missingPolicies.map((policy) => `missing_policy:${policy}`),
  ].filter(Boolean)

  if (failedChecks.length)
    throw new Error(
      `Unsafe WORKER_DATABASE_URL role: ${role.current_role}. Failed checks: ${failedChecks.join(', ')}.`,
    )

  console.log(`Planner, publisher and maintenance worker role verified: ${role.current_role}`)
} finally {
  await client.end()
}
