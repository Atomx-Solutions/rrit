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
      pg_has_role(current_user, 'app_runtime', 'MEMBER') AS is_runtime_member
    FROM pg_roles AS role
    WHERE role.rolname = current_user
  `)
  const runtime = result.rows[0]
  if (!runtime) throw new Error('Could not determine the active database role.')

  if (runtime.is_superuser || runtime.bypasses_rls || !runtime.is_runtime_member) {
    throw new Error(
      `Unsafe DATABASE_URL role: ${runtime.current_role}. Expected a non-superuser, non-BYPASSRLS member of app_runtime.`,
    )
  }

  console.log(`Runtime role verified: ${runtime.current_role}`)
} finally {
  await client.end()
}
