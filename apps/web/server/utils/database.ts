import pg from 'pg'
let pool: pg.Pool | undefined
export function database() {
  if (!process.env.DATABASE_URL)
    throw createError({ statusCode: 503, message: 'Ruajtja në server ende nuk është konfiguruar.' })
  return (pool ||= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  }))
}
