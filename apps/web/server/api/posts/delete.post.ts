import { z } from 'zod'
import { postSchema } from '../../../shared/schemas/workspace'
import { canDeletePost, maxPostsPerDelete } from '../../../shared/utils/post-deletion'
import { recordAuditEvents } from '../../utils/audit'
import { removeAssets } from '../../utils/asset-storage'

const bodySchema = z.object({ ids: z.array(z.uuid()).min(1).max(maxPostsPerDelete) })

// Deletes posts for good, all in one transaction: their rows, versions,
// validations, renders and edits, and the image the AI made for each one when
// no other post uses it. A post that cannot go is reported with its reason and
// the rest are still deleted. The publication ledger is immutable, so a post
// that ever reached a network cannot be deleted.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const body = bodySchema.safeParse(await boundedBody(event))
  if (!body.success) throw createError({ statusCode: 422, message: 'server.FIELDS_OUT_OF_RANGE' })
  const ids = [...new Set(body.data.ids)]

  const failed: { id: string; message: string }[] = []
  const storagePaths: string[] = []
  const deleted = await withBusinessTransaction(user.id, async (client, business) => {
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const rows = await client.query<{ id: string; payload: unknown }>(
      'SELECT id,payload FROM posts WHERE id=ANY($1::uuid[]) AND business_id=$2 FOR UPDATE',
      [ids, business.id],
    )
    const posts = new Map(rows.rows.map((row) => [row.id, postSchema.parse(row.payload)]))

    const published = await client.query<{ post_id: string }>(
      'SELECT DISTINCT post_id FROM publication_attempts WHERE post_id=ANY($1::uuid[]) AND business_id=$2',
      [ids, business.id],
    )
    // A queued render already holds its credits, and a running job would
    // write back to a post that is gone; both finish before the post goes.
    const busy = await client.query<{ post_id: string }>(
      `SELECT post_id FROM video_renders WHERE post_id=ANY($1::uuid[]) AND business_id=$2 AND status IN ('queued','rendering')
       UNION
       SELECT post_id FROM image_edits WHERE post_id=ANY($1::uuid[]) AND business_id=$2 AND status IN ('queued','editing')
       UNION
       SELECT post_id FROM publication_jobs WHERE post_id=ANY($1::uuid[]) AND business_id=$2 AND status IN ('processing','uncertain')`,
      [ids, business.id],
    )
    const publishedIds = new Set(published.rows.map((row) => row.post_id))
    const busyIds = new Set(busy.rows.map((row) => row.post_id))

    const removable: string[] = []
    for (const id of ids) {
      const post = posts.get(id)
      const message = !post
        ? 'server.POST_NOT_FOUND'
        : !canDeletePost(post)
          ? 'server.POST_DELETE_STATUS'
          : publishedIds.has(id)
            ? 'server.POST_DELETE_PUBLICATION_HISTORY'
            : busyIds.has(id)
              ? 'server.POST_DELETE_BUSY'
              : null
      if (message) failed.push({ id, message })
      else removable.push(id)
    }
    if (!removable.length) return []

    const renders = await client.query<{ storage_path: string | null; original_storage_path: string | null }>(
      'SELECT storage_path,original_storage_path FROM video_renders WHERE post_id=ANY($1::uuid[]) AND business_id=$2',
      [removable, business.id],
    )
    for (const render of renders.rows)
      for (const path of [render.storage_path, render.original_storage_path])
        if (path) storagePaths.push(path)

    // Approvals restrict the versions they approve, so they go first.
    await client.query(
      'DELETE FROM post_approval_records WHERE post_id=ANY($1::uuid[]) AND business_id=$2',
      [removable, business.id],
    )
    await client.query('DELETE FROM posts WHERE id=ANY($1::uuid[]) AND business_id=$2', [
      removable,
      business.id,
    ])

    // The AI images made for these posts go with them; a photo the business
    // uploaded stays in its gallery, and so does an image another post still
    // names anywhere (as its photo or as a video source).
    const assetIds = removable
      .map((id) => z.uuid().safeParse(posts.get(id)!.image.replace(/^\/api\/media\//, '')))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data)
    if (assetIds.length) {
      const generated = await client.query<{ storage_path: string | null }>(
        `DELETE FROM assets a
          WHERE a.id=ANY($1::uuid[]) AND a.business_id=$2 AND a.creative_provenance IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM posts p WHERE p.business_id=a.business_id AND strpos(p.payload::text, a.id::text) > 0
            )
          RETURNING storage_path`,
        [assetIds, business.id],
      )
      for (const asset of generated.rows) if (asset.storage_path) storagePaths.push(asset.storage_path)
    }

    // Bumping the revision makes a screen still holding these posts reload
    // instead of saving them back as new ones.
    await client.query('UPDATE businesses SET revision=revision+1,updated_at=now() WHERE id=$1', [
      business.id,
    ])
    await recordAuditEvents(
      client,
      removable.map((id) => {
        const post = posts.get(id)!
        return {
          actorId: user.id,
          organizationId: business.id,
          resourceType: 'post',
          resourceId: id,
          action: 'post.deleted',
          metadata: { status: post.status, channel: post.channel, video: !!post.video },
        }
      }),
    )
    return removable
  })

  try {
    await removeAssets(storagePaths)
  } catch (error) {
    console.error('Failed to remove deleted post files from storage', { count: storagePaths.length, error })
  }
  return { deleted, failed }
})
