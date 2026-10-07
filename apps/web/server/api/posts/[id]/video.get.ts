import { z } from 'zod'
import { hasComposedEndCard } from '../../../utils/video-compose'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{
      id: string
      status: 'rendering' | 'ready' | 'failed'
      failure_reason: string | null
      duration_seconds: number
      source_duration_seconds: number | null
    }>(
      `SELECT r.id,r.status,r.failure_reason,r.duration_seconds,
              NULLIF(p.payload->'video'->>'durationSeconds','')::integer AS source_duration_seconds
         FROM video_renders r JOIN posts p ON p.id=r.post_id
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
        endCardEmbedded: hasComposedEndCard(render.duration_seconds, render.source_duration_seconds),
      },
    }
  })
})
