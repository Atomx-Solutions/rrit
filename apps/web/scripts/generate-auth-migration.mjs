import { writeFile, mkdir } from 'node:fs/promises'
import { getMigrations } from 'better-auth/db/migration'
import pg from 'pg'
// Run against an empty scratch database, review and commit the generated SQL.
// Runtime never generates or applies migrations automatically.
const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!migrationDatabaseUrl) throw new Error('MIGRATION_DATABASE_URL is required.')
const pool = new pg.Pool({ connectionString: migrationDatabaseUrl })
try {
  const plan = await getMigrations({
    database: pool,
    advanced: { database: { generateId: 'uuid' } },
    rateLimit: { enabled: true, storage: 'database' },
  })
  const sql = await plan.compileMigrations()
  if (!sql.trim()) throw new Error('No schema changes to generate.')
  const directory = new URL('../database/migrations/', import.meta.url)
  await mkdir(directory, { recursive: true })
  await writeFile(
    new URL('0001_auth.sql', directory),
    `-- Better Auth 1.7.3, PostgreSQL. Generated from the configured adapter.\n${sql}\n`,
    { flag: 'wx' },
  )
  console.log('Generated 0001_auth.sql. Review before running db:migrate.')
} finally {
  await pool.end()
}
