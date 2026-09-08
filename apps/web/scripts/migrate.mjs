import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import pg from 'pg'

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!migrationDatabaseUrl)
  throw new Error('Set MIGRATION_DATABASE_URL in the root .env before running migrations.')
const pool = new pg.Pool({ connectionString: migrationDatabaseUrl })
const client = await pool.connect()
try {
  await client.query('SELECT pg_advisory_lock(748201938)')
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
  )
  const directory = new URL('../database/migrations/', import.meta.url)
  for (const name of (await readdir(directory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const existing = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [
      name,
    ])
    if (existing.rows.length) {
      if (existing.rows[0].checksum !== checksum)
        throw new Error(`Applied migration ${name} was edited. Add a new migration instead.`)
      console.log(`Already applied: ${name}`)
      continue
    }
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        name,
        checksum,
      ])
      await client.query('COMMIT')
      console.log(`Applied: ${name}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(748201938)')
  client.release()
  await pool.end()
}
