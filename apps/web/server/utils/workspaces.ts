import type { Pool, PoolClient } from 'pg'
import { workspaceSchema, type Workspace } from '../../shared/schemas/workspace'

type WorkspaceBusinessRow = {
  id: string
  owner_id: string
  slug: string
  state: object
  revision: number
}

export async function loadWorkspace(
  db: Pool | PoolClient,
  id: string,
  owner: string,
  preloadedBusiness?: WorkspaceBusinessRow,
  onTiming?: (phase: string, durationMs: number) => void,
) {
  const row = preloadedBusiness || (
    await db.query<WorkspaceBusinessRow>(
      'SELECT id, owner_id, slug, state, revision FROM businesses WHERE id = $1 AND owner_id = $2',
      [id, owner],
    )
  ).rows[0]
  if (!row || row.id !== id || row.owner_id !== owner)
    throw createError({ statusCode: 404, message: 'server.BUSINESS_NOT_FOUND' })
  const timedQuery = async <T>(phase: string, action: () => Promise<T>): Promise<T> => {
    const startedAt = performance.now()
    try {
      return await action()
    } finally {
      try { onTiming?.(phase, performance.now() - startedAt) } catch { /* diagnostics only */ }
    }
  }
  const [posts, assets] = await Promise.all([
    timedQuery('posts', () => db.query('SELECT payload, created_at FROM posts WHERE business_id = $1 ORDER BY created_at DESC, id', [id])),
    timedQuery('assets', () => db.query(
      "SELECT id, name, tags, rights, kind, creative_provenance IS NOT NULL AS generated, COALESCE(size_bytes, octet_length(bytes))::integer AS size FROM assets WHERE business_id = $1 ORDER BY created_at DESC, id",
      [id],
    )),
  ])
  const workspace: Workspace = workspaceSchema.parse({
    ...row.state,
    revision: row.revision,
    posts: posts.rows.map((p) => ({ ...p.payload, createdAt: new Date(p.created_at).toISOString() })),
    assets: assets.rows.map((a) => ({
      ...a,
      size: Number(a.size),
      kind: a.kind as 'photo' | 'brand',
      url: `/api/media/${a.id}`,
    })),
  })
  return { id: row.id as string, slug: row.slug as string, workspace }
}
