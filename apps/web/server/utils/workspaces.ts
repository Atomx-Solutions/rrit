import type { Pool, PoolClient } from 'pg'
import { workspaceSchema, type Workspace } from '../../shared/schemas/workspace'
import {
  workspaceBootstrapSchema,
  type WorkspaceBootstrap,
} from '../../shared/schemas/workspace-resources'
import { getBrandBySlug } from './brands'

export async function loadWorkspaceBootstrap(
  db: PoolClient,
  id: string,
  owner: string,
): Promise<WorkspaceBootstrap> {
  const business = await db.query(
    'SELECT id, slug, state, revision FROM businesses WHERE id = $1 AND owner_id = $2',
    [id, owner],
  )
  if (!business.rows[0]) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  const row = business.rows[0]
  const [postCount, assetCount, brand] = await Promise.all([
    db.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM posts WHERE business_id=$1',
      [id],
    ),
    db.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM assets WHERE business_id=$1',
      [id],
    ),
    getBrandBySlug(db, id, row.slug as string),
  ])
  const rawPreferences = workspaceSchema.shape.preferences.parse(row.state.preferences)
  const preferences = workspaceSchema.shape.preferences.parse({
    ...rawPreferences,
    ...(brand
      ? {
          timezone: brand.timezone,
          locale: brand.locale,
          emailApprovals: brand.settings.emailApprovals,
          emailPublished: brand.settings.emailPublished,
          emailTips: brand.settings.emailTips,
        }
      : {}),
  })
  return workspaceBootstrapSchema.parse({
    id: row.id,
    slug: row.slug,
    revision: Number(row.revision),
    brand,
    preferences,
    onboarding: row.state.onboarding,
    dismissed: row.state.dismissed,
    notificationsRead: row.state.notificationsRead,
    postCount: Number(postCount.rows[0]?.count || 0),
    assetCount: Number(assetCount.rows[0]?.count || 0),
    capabilities: { posts: true, assets: true, brand: true, preferences: true },
  })
}

export async function loadFullWorkspace(db: Pool | PoolClient, id: string, owner: string) {
  const business = await db.query(
    'SELECT id, slug, state, revision FROM businesses WHERE id = $1 AND owner_id = $2',
    [id, owner],
  )
  if (!business.rows[0]) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  const row = business.rows[0]
  const [posts, assets] = await Promise.all([
    db.query('SELECT payload FROM posts WHERE business_id = $1 ORDER BY created_at DESC, id', [id]),
    db.query(
      'SELECT id, name, tags, rights, creative_provenance IS NOT NULL AS generated, COALESCE(size_bytes, octet_length(bytes))::integer AS size FROM assets WHERE business_id = $1 ORDER BY created_at DESC, id',
      [id],
    ),
  ])
  const workspace: Workspace = workspaceSchema.parse({
    ...row.state,
    revision: row.revision,
    posts: posts.rows.map((p) => p.payload),
    assets: assets.rows.map((a) => ({
      ...a,
      size: Number(a.size),
      kind: 'photo',
      url: `/api/media/${a.id}`,
    })),
  })
  return { id: row.id as string, slug: row.slug as string, workspace }
}

// Temporary compatibility alias for callers that still require the complete workspace.
export const loadWorkspace = loadFullWorkspace
