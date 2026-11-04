import { z } from 'zod'
import { videoMusicChoiceSchema } from '../../../../shared/schemas/music'
import { postSchema } from '../../../../shared/schemas/workspace'
import { resolveVideoMusic } from '../../../utils/music-library'
import { queueVideoRender } from '../../../utils/video-render'
import { startVideoRenderNow } from '../../../utils/planner-run'

// The first render of a video. The business chooses its music with it: a video
// is never made before the business has said whether it wants AI music, a
// library track or none.
export default defineEventHandler(async (event) => {
  const started = Date.now()
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const input = z.object({ music: videoMusicChoiceSchema.optional() })
    .safeParse(await boundedBody(event, 1024))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'server.MUSIC_CHOICE_INVALID' })
  await withBusinessTransaction(user.id, async (client, business) => {
    const row = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, business.id])
    if (!row.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
    const post = postSchema.parse(row.rows[0].payload)
    if (!post.video) throw createError({ statusCode: 409, message: 'server.VIDEO_BRIEF_REQUIRED' })
    if (!input.data.music) {
      if (!post.video.music) throw createError({ statusCode: 422, message: 'server.MUSIC_CHOICE_REQUIRED' })
      return
    }
    post.video.music = (await resolveVideoMusic(client, input.data.music)).music
    await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(post), id, business.id])
  })
  // The render is queued and starts at once; the editor follows its status.
  const queued = await queueVideoRender(user.id, id)
  startVideoRenderNow(event, started)
  setResponseStatus(event, 202)
  return queued
})
