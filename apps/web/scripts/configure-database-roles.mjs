import { randomBytes } from 'node:crypto'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL
if (!migrationDatabaseUrl) {
  throw new Error('Set MIGRATION_DATABASE_URL in the root .env before configuring database roles.')
}

const envPath = fileURLToPath(new URL('../../../.env', import.meta.url))
const webPassword = randomBytes(32).toString('hex')
const workerPassword = randomBytes(32).toString('hex')

function roleConnectionString(connectionString, role, password) {
  const url = new URL(connectionString)
  const migrationRole = decodeURIComponent(url.username)
  const projectSuffix = migrationRole.includes('.')
    ? migrationRole.slice(migrationRole.indexOf('.'))
    : ''

  url.username = `${role}${projectSuffix}`
  url.password = password
  return url.toString()
}

async function configureRoles() {
  const admin = new pg.Client({ connectionString: migrationDatabaseUrl })
  await admin.connect()

  try {
    await admin.query('BEGIN')
    await admin.query(
      `SELECT
         set_config('rrit.web_password', $1, true),
         set_config('rrit.worker_password', $2, true)`,
      [webPassword, workerPassword],
    )
    const roleSafety = await admin.query(`
      SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles
      WHERE rolname = ANY(ARRAY['rrit_web', 'rrit_planner'])
    `)
    if (
      roleSafety.rows.length !== 2 ||
      roleSafety.rows.some(
        (role) =>
          role.rolsuper ||
          role.rolcreatedb ||
          role.rolcreaterole ||
          role.rolreplication ||
          role.rolbypassrls,
      )
    ) {
      throw new Error('The application database roles have unsafe capability attributes.')
    }
    await admin.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_web') THEN
          RAISE EXCEPTION 'Role rrit_web is missing. Apply database migrations first.';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_planner') THEN
          RAISE EXCEPTION 'Role rrit_planner is missing. Apply database migrations first.';
        END IF;

        EXECUTE format(
          'ALTER ROLE %I WITH LOGIN INHERIT PASSWORD %L',
          'rrit_web',
          current_setting('rrit.web_password')
        );
        EXECUTE format(
          'ALTER ROLE %I WITH LOGIN INHERIT PASSWORD %L',
          'rrit_planner',
          current_setting('rrit.worker_password')
        );

        GRANT app_runtime TO rrit_web;
        GRANT rrit_worker TO rrit_planner;
        REVOKE app_runtime FROM rrit_planner;
      END
      $$;
    `)
    await admin.query('COMMIT')
  } catch (error) {
    await admin.query('ROLLBACK')
    throw error
  } finally {
    await admin.end()
  }
}

async function verifyConnection(connectionString, expectedRole, membershipRole, forbiddenRole) {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const result = await client.query(
      `SELECT
         current_user AS current_role,
         role.rolsuper AS is_superuser,
         role.rolbypassrls AS bypasses_rls,
         pg_has_role(current_user, $1, 'MEMBER') AS has_required_membership,
         pg_has_role(current_user, $2, 'MEMBER') AS has_forbidden_membership
       FROM pg_roles AS role
       WHERE role.rolname = current_user`,
      [membershipRole, forbiddenRole],
    )
    const activeRole = result.rows[0]
    if (
      !activeRole ||
      activeRole.current_role !== expectedRole ||
      activeRole.is_superuser ||
      activeRole.bypasses_rls ||
      !activeRole.has_required_membership ||
      activeRole.has_forbidden_membership
    ) {
      throw new Error(`The ${expectedRole} credential did not pass its role safety check.`)
    }
  } finally {
    await client.end()
  }
}

function setEnvValue(content, name, value, newline) {
  const line = `${name}=${value}`
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  if (pattern.test(content)) return content.replace(pattern, line)
  return `${content.replace(/\s*$/, '')}${newline}${line}${newline}`
}

async function writeCredentials(databaseUrl, workerDatabaseUrl) {
  const current = await readFile(envPath, 'utf8')
  const newline = current.includes('\r\n') ? '\r\n' : '\n'
  const fileStats = await stat(envPath)
  let updated = setEnvValue(current, 'DATABASE_URL', databaseUrl, newline)
  updated = setEnvValue(updated, 'WORKER_DATABASE_URL', workerDatabaseUrl, newline)

  const temporaryPath = `${envPath}.database-roles.tmp`
  try {
    await writeFile(temporaryPath, updated, { encoding: 'utf8', mode: fileStats.mode })
    await rename(temporaryPath, envPath)
  } finally {
    await unlink(temporaryPath).catch(() => {})
  }
}

const databaseUrl = roleConnectionString(migrationDatabaseUrl, 'rrit_web', webPassword)
const workerDatabaseUrl = roleConnectionString(
  migrationDatabaseUrl,
  'rrit_planner',
  workerPassword,
)

await configureRoles()
await verifyConnection(databaseUrl, 'rrit_web', 'app_runtime', 'rrit_worker')
await verifyConnection(workerDatabaseUrl, 'rrit_planner', 'rrit_worker', 'app_runtime')
await writeCredentials(databaseUrl, workerDatabaseUrl)

console.log('Configured and verified restricted Supabase credentials for web and workers.')
