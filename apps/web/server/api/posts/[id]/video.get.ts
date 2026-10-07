import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{
      id: string
      status: 'rendering' | 'ready' | 'failed'
      failure_reason: string | null
    }>(
      'SELECT id,status,failure_reason FROM video_renders WHERE post_id=$1 AND business_id=$2 ORDER BY created_at DESC LIMIT 1',
      [id, business.id],
    )
    const render = result.rows[0]
    return {
      render: render && {
        id: render.id,
        status: render.status,
        failureReason: render.failure_reason,
        previewUrl: render.status === 'ready' ? `/api/videos/${render.id}` : null,
      },
    }
  })
})
