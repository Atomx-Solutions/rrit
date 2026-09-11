import type { Pool, PoolClient } from 'pg'
import { workspaceSchema, type Workspace } from '../../shared/schemas/workspace'

export async function loadWorkspace(db: Pool | PoolClient, id: string, owner: string) {
  const business = await db.query(
    'SELECT id, slug, state, revision FROM businesses WHERE id = $1 AND owner_id = $2',
    [id, owner],
  )
  if (!business.rows[0]) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  const row = business.rows[0]
  const posts = await db.query('SELECT payload FROM posts WHERE business_id = $1 ORDER BY created_at DESC, id', [id])
  const assets = await db.query(
    'SELECT id, name, tags, rights, COALESCE(size_bytes, octet_length(bytes))::integer AS size FROM assets WHERE business_id = $1 ORDER BY created_at DESC, id',
    [id],
  )
  const workspace: Workspace = workspaceSchema.parse({
    ...row.state,
    revision: row.revision,
    posts: posts.rows.map((p) => p.payload),
    assets: assets.rows.map((a) => ({ ...a, kind: 'photo', url: `/api/media/${a.id}` })),
  })
  return { id: row.id as string, slug: row.slug as string, workspace }
}
