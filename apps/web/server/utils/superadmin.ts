import type { PoolClient } from 'pg'

export function isAdminApiPath(path: string) {
  return path === '/api/admin' || path.startsWith('/api/admin/')
}

export async function hasSuperadminRole(client: PoolClient, userId: string) {
  const result = await client.query(
    `SELECT 1 FROM platform_user_roles
      WHERE user_id=$1 AND role='superadmin'
      LIMIT 1`,
    [userId],
  )
  return result.rows.length > 0
}
