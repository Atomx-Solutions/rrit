import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('Set DATABASE_URL to the restricted web/API database credential.')
}

const client = new pg.Client({ connectionString })

try {
  await client.connect()
  const result = await client.query(`
    SELECT
      current_user AS current_role,
      session_user AS session_role,
      role.rolsuper AS is_superuser,
      role.rolbypassrls AS bypasses_rls,
      pg_has_role(current_user, 'app_runtime', 'MEMBER') AS is_runtime_member,
      has_table_privilege(current_user, 'schema_migrations', 'SELECT')
        AND has_table_privilege(current_user, 'app_settings', 'SELECT')
        AND has_table_privilege(current_user, 'plan_catalog', 'SELECT')
        AND has_table_privilege(current_user, 'worker_heartbeats', 'SELECT')
        AS reference_read_access,
      has_table_privilege(current_user, 'outbox_messages', 'SELECT')
        AND has_table_privilege(current_user, 'outbox_messages', 'INSERT')
        AND has_table_privilege(current_user, 'outbox_messages', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'outbox_messages', 'DELETE')
        AND NOT has_table_privilege(current_user, 'outbox_consumptions', 'SELECT')
        AS safe_outbox_access,
      has_table_privilege(current_user, 'trial_claims', 'SELECT')
        AND has_table_privilege(current_user, 'trial_claims', 'INSERT')
        AND NOT has_table_privilege(current_user, 'trial_claims', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'trial_claims', 'DELETE')
        AS safe_trial_claim_access,
      has_function_privilege(current_user, 'app.audit_metadata_is_safe(jsonb)', 'EXECUTE')
        AS audit_validation_access
    FROM pg_roles AS role
    WHERE role.rolname = current_user
  `)
  const runtime = result.rows[0]
  if (!runtime) throw new Error('Could not determine the active database role.')
  const rlsResult = await client.query(`
    SELECT array_agg(class.relname ORDER BY class.relname) AS unprotected_tables
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = current_schema()
      AND class.relkind IN ('r', 'p')
      AND NOT class.relrowsecurity
  `)
  const unprotectedTables = rlsResult.rows[0]?.unprotected_tables || []

  if (
    runtime.is_superuser ||
    runtime.bypasses_rls ||
    !runtime.is_runtime_member ||
    !runtime.reference_read_access ||
    !runtime.safe_outbox_access ||
    !runtime.safe_trial_claim_access ||
    !runtime.audit_validation_access ||
    unprotectedTables.length
  ) {
    throw new Error(
      `Unsafe DATABASE_URL role: ${runtime.current_role}. Expected a restricted app_runtime member with RLS active on every application table.`,
    )
  }

  console.log(`Runtime role verified: ${runtime.current_role}`)
} finally {
  await client.end()
}
