import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{
      id: string
      status: 'rendering' | 'ready' | 'failed'
      failure_reason: string | null
      composed: boolean
    }>(
      `SELECT r.id,r.status,r.failure_reason,r.composed
         FROM video_renders r
        WHERE r.post_id=$1 AND r.business_id=$2 ORDER BY r.created_at DESC LIMIT 1`,
      [id, business.id],
    )
    const render = result.rows[0]
    return {
      render: render && {
        id: render.id,
        status: render.status,
        failureReason: render.failure_reason,
        previewUrl: render.status === 'ready' ? `/api/videos/${render.id}` : null,
        // A composed MP4 carries whatever end-card it has; only a raw legacy
        // clip needs the separate card shown beside it.
        endCardEmbedded: render.composed,
      },
    }
  })
})
