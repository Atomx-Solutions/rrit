import type { Pool, PoolClient } from 'pg'
import sharp from 'sharp'
import { channelCanvas, matchesChannelCanvas, type Canvas } from '../../shared/schemas/channel-format'
import type { Post } from '../../shared/schemas/workspace'
import { assetStorageFolder, downloadAsset, uploadBinaryAsset } from './asset-storage'
import { conformImageToCanvas } from './image-processing'
import type { PostCheck } from './post-validation'
import { conformVideoToCanvas, videoInfo } from './video-compose'

export type DeliveredMediaTools = {
  download: (path: string, maxBytes: number) => Promise<Buffer>
  upload: (path: string, bytes: Buffer, contentType: string) => Promise<void>
  imageSize: (bytes: Buffer) => Promise<Canvas>
  videoSize: (bytes: Buffer) => Promise<Canvas>
  conformImage: (bytes: Buffer, canvas: Canvas) => Promise<Buffer>
  conformVideo: (bytes: Buffer, canvas: Canvas) => Promise<Buffer>
  // The storage allowance the conformed file adds to.
  reserveStorage: (bytes: number) => Promise<void>
}

function defaultTools(businessId: string, db: Pool | PoolClient): DeliveredMediaTools {
  return {
    download: (path, maxBytes) => downloadAsset(path, maxBytes),
    upload: (path, bytes, contentType) => uploadBinaryAsset(path, bytes, contentType),
    imageSize: async (bytes) => {
      const meta = await sharp(bytes).metadata()
      const rotated = (meta.orientation || 1) >= 5
      return { width: (rotated ? meta.height : meta.width) || 0, height: (rotated ? meta.width : meta.height) || 0 }
    },
    videoSize: (bytes) => videoInfo(bytes),
    conformImage: conformImageToCanvas,
    conformVideo: conformVideoToCanvas,
    reserveStorage: async (bytes) => {
      await requireQuota(businessId, 'media_storage_bytes', bytes, db as PoolClient)
    },
  }
}

export type DeliveredMedia = {
  checks: PostCheck[]
  // The image the channel receives, when it is not the post's own image.
  imageAssetId?: string
}

/**
 * Makes sure the very file a channel receives is on that channel's canvas,
 * fixing it instead of blocking the post. The file is read from storage, not
 * from the row describing it. One in the wrong shape is set whole over a
 * blurred fill of itself on the right canvas, with nothing cut or stretched:
 * a video's render then points at the conformed file and remembers the one it
 * was made as; an image gets a conformed copy that is published in its place,
 * and the post itself is not changed. A photo uploaded by hand for a feed
 * keeps the platform limits of localPostChecks instead.
 */
export async function conformDeliveredMedia(
  post: Post,
  businessId: string,
  // Who is publishing: the user, or the owner when the worker publishes.
  actorId: string,
  db: Pool | PoolClient,
  tools: DeliveredMediaTools = defaultTools(businessId, db),
): Promise<DeliveredMedia> {
  const canvas = channelCanvas(post.channel)
  const missing = (actual: string): DeliveredMedia => ({
    checks: [{ key: 'delivered_canvas', passed: false, message: 'server.DELIVERED_FILE_UNAVAILABLE', params: { actual } }],
  })
  const confirmed = (message: string, extra: Omit<DeliveredMedia, 'checks'> = {}): DeliveredMedia => ({
    checks: [{ key: 'delivered_canvas', passed: true, message, params: { channel: post.channel } }],
    ...extra,
  })
  const folder = async () => {
    const business = (await db.query('SELECT slug FROM businesses WHERE id=$1', [businessId])).rows[0] as { slug: string } | undefined
    return assetStorageFolder(business?.slug || 'business', businessId)
  }

  if (post.video) {
    const render = (await db.query(
      "SELECT id,storage_path FROM video_renders WHERE post_id=$1 AND business_id=$2 AND status='ready' ORDER BY created_at DESC LIMIT 1",
      [post.id, businessId],
    )).rows[0] as { id: string; storage_path: string | null } | undefined
    if (!render?.storage_path) return missing('missing')
    let video: Buffer
    let size: Canvas
    try {
      video = await tools.download(render.storage_path, 200 * 1024 * 1024)
      size = await tools.videoSize(video)
    } catch {
      return missing('unreadable')
    }
    if (matchesChannelCanvas(post.channel, size)) return confirmed('validation.deliveredFormatConfirmed')
    const conformed = await tools.conformVideo(video, canvas)
    await tools.reserveStorage(conformed.length)
    const path = `${await folder()}/video-${post.id}-${render.id}-${canvas.width}x${canvas.height}.mp4`
    await tools.upload(path, conformed, 'video/mp4')
    await db.query(
      `UPDATE video_renders
          SET original_storage_path=COALESCE(original_storage_path,storage_path),
              storage_path=$1,size_bytes=$2,width=$3,height=$4
        WHERE id=$5 AND business_id=$6`,
      [path, conformed.length, canvas.width, canvas.height, render.id, businessId],
    )
    await auditConformed(db, businessId, actorId, post.id)
    return confirmed('validation.deliveredFormatFixed')
  }

  if (!post.aiProvenance && post.channel !== 'TikTok') return { checks: [] }
  const assetId = /^\/api\/media\/([a-f0-9-]{36})$/i.exec(post.image)?.[1]
  if (!assetId) return missing('missing')
  const asset = (await db.query(
    'SELECT storage_path,bytes,name FROM assets WHERE id=$1 AND business_id=$2 AND rights=true',
    [assetId, businessId],
  )).rows[0] as { storage_path: string | null; bytes: Buffer | null; name: string } | undefined
  if (!asset || (!asset.storage_path && !asset.bytes)) return missing('missing')
  let image: Buffer
  let size: Canvas
  try {
    image = asset.bytes || await tools.download(asset.storage_path!, 20 * 1024 * 1024)
    size = await tools.imageSize(image)
  } catch {
    return missing('unreadable')
  }
  if (matchesChannelCanvas(post.channel, size)) return confirmed('validation.deliveredFormatConfirmed')
  // A copy made for this channel earlier is reused rather than made again.
  const existing = (await db.query(
    `SELECT id FROM assets
      WHERE business_id=$1 AND rights=true
        AND creative_provenance->>'source'='channel-conform'
        AND creative_provenance->>'sourceAssetId'=$2
        AND creative_provenance->>'channel'=$3
      ORDER BY created_at DESC LIMIT 1`,
    [businessId, assetId, post.channel],
  )).rows[0] as { id: string } | undefined
  if (existing) return confirmed('validation.deliveredFormatFixed', { imageAssetId: existing.id })
  const conformed = await tools.conformImage(image, canvas)
  await tools.reserveStorage(conformed.length)
  const id = crypto.randomUUID()
  const path = `${await folder()}/conformed-${id}.jpg`
  await tools.upload(path, conformed, 'image/jpeg')
  await db.query(
    "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,storage_path,size_bytes,width,height,creative_provenance) VALUES($1,$2,$3,$4,true,'image/jpeg',NULL,$5,$6,$7,$8,$9)",
    [
      id,
      businessId,
      asset.name,
      JSON.stringify(['channel-conform']),
      path,
      conformed.length,
      canvas.width,
      canvas.height,
      JSON.stringify({ source: 'channel-conform', sourceAssetId: assetId, channel: post.channel, from: `${size.width}x${size.height}` }),
    ],
  )
  await auditConformed(db, businessId, actorId, post.id)
  return confirmed('validation.deliveredFormatFixed', { imageAssetId: id })
}

async function auditConformed(db: Pool | PoolClient, businessId: string, actorId: string, postId: string) {
  await db.query(
    "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) SELECT id,id,$2,'media.channel_conformed','post',$3,'succeeded',revision FROM businesses WHERE id=$1",
    [businessId, actorId, postId],
  )
}
