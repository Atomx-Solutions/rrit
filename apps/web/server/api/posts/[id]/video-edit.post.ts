import { z } from 'zod'
import { postSchema } from '../../../../shared/schemas/workspace'
import { renderVideoForPost } from '../../../utils/video-render'

// Edit video with AI: the business tells the creative director in its own
// words what the next take should be, and the video is rendered again from the
// same photograph under the same rules.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const input = z.object({
    instruction: z.string().trim().min(5).max(600),
  }).safeParse(await boundedBody(event, 4096))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'server.VIDEO_EDIT_INSTRUCTION_REQUIRED' })
  await withBusinessTransaction(user.id, async (client, business) => {
    const row = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, business.id])
    if (!row.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
    const post = postSchema.parse(row.rows[0].payload)
    if (!post.video) throw createError({ statusCode: 409, message: 'server.VIDEO_BRIEF_REQUIRED' })
    if (!['draft', 'review', 'failed'].includes(post.status))
      throw createError({ statusCode: 422, message: 'server.REOPEN_AS_DRAFT' })
    post.video.editInstruction = input.data.instruction
    await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(post), id, business.id])
    await client.query(
      "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) SELECT id,id,$2,'video.ai_edit_requested','post',$3,'succeeded',revision FROM businesses WHERE id=$1",
      [business.id, user.id, id],
    )
  })
  return renderVideoForPost(user.id, id)
})
