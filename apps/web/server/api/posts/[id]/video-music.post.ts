import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { videoMusicChoiceSchema } from '../../../../shared/schemas/music'
import { postSchema } from '../../../../shared/schemas/workspace'
import { assetStorageFolder, downloadAsset, removeAsset, uploadBinaryAsset } from '../../../utils/asset-storage'
import { downloadMusicTrack, resolveVideoMusic } from '../../../utils/music-library'
import { addMusicToVideo, removeMusicFromVideo } from '../../../utils/video-compose'

// The largest finished video the editor plays back; the same bound the
// video route reads with.
const MAX_VIDEO_BYTES = 60 * 1024 * 1024

// Change the music under a post's video. The choice is kept for every later
// render. A library track or silence is also laid under the video already
// made, at once and at no cost, because only the sound changes; AI music is
// made from the video, so it comes with the next render.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const input = videoMusicChoiceSchema.safeParse(await boundedBody(event, 1024))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'server.MUSIC_CHOICE_INVALID' })

  const snapshot = await withBusinessTransaction(user.id, async (client, business) => {
    const row = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, business.id])
    if (!row.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
    const post = postSchema.parse(row.rows[0].payload)
    if (!post.video) throw createError({ statusCode: 409, message: 'server.VIDEO_BRIEF_REQUIRED' })
    if (!['draft', 'review', 'failed'].includes(post.status))
      throw createError({ statusCode: 422, message: 'server.REOPEN_AS_DRAFT' })
    if (post.video.status === 'rendering')
      throw createError({ statusCode: 409, message: 'server.VIDEO_RENDER_IN_PROGRESS' })

    const { music, storagePath: trackPath } = await resolveVideoMusic(client, input.data)
    post.video.music = music
    await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(post), id, business.id])
    await client.query(
      "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) SELECT id,id,$2,'video.music_changed','post',$3,'succeeded',revision FROM businesses WHERE id=$1",
      [business.id, user.id, id],
    )
    const render = await client.query<{ id: string; storage_path: string; size_bytes: string | null }>(
      "SELECT id,storage_path,size_bytes FROM video_renders WHERE post_id=$1 AND business_id=$2 AND status='ready' AND storage_path IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      [id, business.id],
    )
    return { music, trackPath, render: render.rows[0], folder: assetStorageFolder(business.slug, business.id) }
  })

  if (snapshot.music.source === 'ai' || !snapshot.render) return { music: snapshot.music, remixed: false }

  const video = await downloadAsset(snapshot.render.storage_path, MAX_VIDEO_BYTES)
  const bytes = snapshot.trackPath
    ? await addMusicToVideo(video, await downloadMusicTrack(snapshot.trackPath))
    : await removeMusicFromVideo(video)
  const path = `${snapshot.folder}/video-${id}-${randomUUID()}.mp4`
  await uploadBinaryAsset(path, bytes, 'video/mp4')
  try {
    await withBusinessTransaction(user.id, async (client, business) => {
      const grows = bytes.length - Number(snapshot.render!.size_bytes || video.length)
      if (grows > 0) await requireQuota(business.id, 'media_storage_bytes', grows, client)
      // Only the render that was read is replaced; one made meanwhile wins.
      const updated = await client.query(
        "UPDATE video_renders SET storage_path=$1,size_bytes=$2 WHERE id=$3 AND business_id=$4 AND storage_path=$5 AND status='ready'",
        [path, bytes.length, snapshot.render!.id, business.id, snapshot.render!.storage_path],
      )
      if (!updated.rowCount) throw createError({ statusCode: 409, message: 'server.POST_CHANGED_DURING_VALIDATION' })
    })
  } catch (error) {
    await removeAsset(path).catch((cleanupError) =>
      console.error('Failed to remove a remixed video after a failed update', { storagePath: path, error: cleanupError }))
    throw error
  }
  await removeAsset(snapshot.render.storage_path).catch((error) =>
    console.error('Failed to remove the video replaced by new music', { storagePath: snapshot.render!.storage_path, error }))
  return { music: snapshot.music, remixed: true }
})
