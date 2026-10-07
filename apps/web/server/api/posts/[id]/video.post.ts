import { z } from 'zod'
import {
  postSchema,
  videoDurationSeconds,
  videoFormat,
} from '../../../../shared/schemas/workspace'

const paramsSchema = z.object({ id: z.uuid() })

// This creates the durable brief used by the renderer. It deliberately never
// reruns monthly research or strategy; it derives only from the selected post
// and real business photos already stored with the post's business.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const { id } = paramsSchema.parse(getRouterParams(event))
  return withBusinessTransaction(user.id, async (client, business) => {
    const current = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, business.id])
    if (!current.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
    const post = postSchema.parse(current.rows[0].payload)
    const assets = await client.query<{ id: string; tags: string[]; kind: string }>("SELECT id,tags,kind FROM assets WHERE business_id=$1 AND rights=true AND kind='photo' AND creative_provenance IS NULL ORDER BY created_at ASC", [business.id])
    const postAssetId = post.image.match(/^\/api\/media\/([0-9a-f-]{36})$/i)?.[1]
    const selected = assets.rows.filter((asset) => asset.id === postAssetId)
    if (!selected.length)
      throw createError({ statusCode: 409, message: 'server.VIDEO_PHOTO_REQUIRED' })
    const logo = await client.query<{ id: string }>("SELECT id FROM assets WHERE business_id=$1 AND rights=true AND kind='brand' AND tags ? 'logo' ORDER BY created_at DESC LIMIT 1", [business.id])
    const hook = post.title.slice(0, 120)
    post.video = {
      status: 'brief_ready', sourceAssetIds: selected.map((asset) => asset.id), logoAssetId: logo.rows[0]?.id,
      hook, overlays: [post.pillar.slice(0, 120)], cta: post.caption.slice(0, 120),
      durationSeconds: videoDurationSeconds, format: videoFormat,
      createdAt: new Date().toISOString(),
    }
    await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(post), id, business.id])
    return { brief: post.video }
  })
})
