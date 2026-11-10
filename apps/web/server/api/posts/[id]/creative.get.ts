import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  return withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{
      id: string
      status: 'queued' | 'editing' | 'ready' | 'failed'
      failure_reason: string | null
    }>(
      'SELECT id,status,failure_reason FROM image_edits WHERE post_id=$1 AND business_id=$2 ORDER BY created_at DESC LIMIT 1',
      [id, business.id],
    )
    const edit = result.rows[0]
    return {
      edit: edit && { id: edit.id, status: edit.status, failureReason: edit.failure_reason },
    }
  })
})
