import { createHash } from 'node:crypto'
import { z } from 'zod'
import { downloadAsset } from '../../utils/asset-storage'
import { videoByteRange } from '../../utils/video-range'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const render = await withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{ storage_path: string }>(
      "SELECT storage_path FROM video_renders WHERE id=$1 AND business_id=$2 AND status='ready' AND storage_path IS NOT NULL",
      [id, business.id],
    )
    if (!result.rows[0]) throw createError({ statusCode: 404, message: 'server.VIDEO_NOT_FOUND' })
    return result.rows[0]
  })
  // A render keeps its id when its music is changed, but gets a new file, so
  // the file path is the version. The browser keeps the video and only asks
  // whether it is still current: an unchanged video answers 304 without
  // fetching it from storage again.
  const etag = `"${createHash('sha256').update(render.storage_path).digest('base64url').slice(0, 22)}"`
  setHeader(event, 'ETag', etag)
  setHeader(event, 'Cache-Control', 'private, no-cache')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }
  const video = await downloadAsset(render.storage_path, 60 * 1024 * 1024)
  setHeader(event, 'Content-Type', 'video/mp4')
  setHeader(event, 'Content-Disposition', 'inline')
  // Answering a byte range lets the player start and jump within the video
  // instead of treating it as one download it cannot seek.
  setHeader(event, 'Accept-Ranges', 'bytes')
  const range = videoByteRange(getRequestHeader(event, 'range'), video.length)
  if (range === 'invalid') {
    setHeader(event, 'Content-Range', `bytes */${video.length}`)
    setResponseStatus(event, 416)
    return null
  }
  if (!range) return video
  setResponseStatus(event, 206)
  setHeader(event, 'Content-Range', `bytes ${range.start}-${range.end}/${video.length}`)
  return video.subarray(range.start, range.end + 1)
})
