import { postSchema } from '../../shared/schemas/workspace'
import { downloadAsset } from './asset-storage'
import { extractVideoFrames } from './video-compose'
import { reviewVideoQuality } from './video-subject-check'

/** Review a ready render made before video QA was introduced, without rendering again. */
export async function reviewExistingVideoQuality(userId: string, postId: string) {
  const snapshot = await withBusinessTransaction(userId, async (client, business) => {
    const result = await client.query<{ payload: unknown }>(
      'SELECT payload FROM posts WHERE id=$1 AND business_id=$2',
      [postId, business.id],
    )
    const post = result.rows[0] && postSchema.parse(result.rows[0].payload)
    if (!post?.video || post.video.status !== 'ready')
      throw createError({ statusCode: 409, message: 'server.VIDEO_REQUIRED_FOR_PUBLISHING' })
    const version = post.contentVersion ?? 1
    if (post.video.quality && post.video.qualityContentVersion === version)
      return { existing: post.video.quality }
    const render = await client.query<{ id: string; storage_path: string }>(
      "SELECT id,storage_path FROM video_renders WHERE post_id=$1 AND business_id=$2 AND status='ready' AND storage_path IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      [postId, business.id],
    )
    const source = await client.query<{ bytes: Buffer | null; storage_path: string | null }>(
      'SELECT bytes,storage_path FROM assets WHERE id=$1 AND business_id=$2 AND rights=true',
      [post.video.sourceAssetIds[0], business.id],
    )
    if (!render.rows[0] || !source.rows[0])
      throw createError({ statusCode: 409, message: 'server.ORIGINAL_PHOTO_UNAVAILABLE' })
    const { workspace } = await loadWorkspace(client, business.id, userId)
    const factIds = new Set(post.aiProvenance?.factIds || [])
    return {
      version,
      renderId: render.rows[0].id,
      videoPath: render.rows[0].storage_path,
      source: source.rows[0].storage_path
        ? await downloadAsset(source.rows[0].storage_path, 10 * 1024 * 1024)
        : source.rows[0].bytes!,
      caption: post.caption,
      brandName: workspace.brand.name,
      locale: workspace.preferences.locale,
      verifiedFacts: workspace.brand.facts.filter((fact) => factIds.has(fact.id)).map((fact) => fact.text),
      targetChannel: post.channel,
    }
  })
  if ('existing' in snapshot) return snapshot.existing
  const video = await downloadAsset(snapshot.videoPath, 100 * 1024 * 1024)
  const quality = await reviewVideoQuality({
    photograph: snapshot.source,
    frames: await extractVideoFrames(video, [0.1, 0.4, 0.7, 0.95]),
    caption: snapshot.caption,
    brandName: snapshot.brandName,
    locale: snapshot.locale,
    verifiedFacts: snapshot.verifiedFacts,
    targetChannel: snapshot.targetChannel,
  })
  await withBusinessTransaction(userId, async (client, business) => {
    const result = await client.query<{ payload: unknown }>(
      'SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [postId, business.id],
    )
    const post = result.rows[0] && postSchema.parse(result.rows[0].payload)
    const render = await client.query<{ id: string }>(
      "SELECT id FROM video_renders WHERE post_id=$1 AND business_id=$2 AND status='ready' ORDER BY created_at DESC LIMIT 1",
      [postId, business.id],
    )
    if (!post?.video || (post.contentVersion ?? 1) !== snapshot.version || render.rows[0]?.id !== snapshot.renderId)
      throw createError({ statusCode: 409, message: 'server.POST_CHANGED_DURING_VALIDATION' })
    post.video.quality = quality
    post.video.qualityContentVersion = snapshot.version
    post.policy = quality.factuality ? 'warn' : 'block'
    post.policyReason = quality.reasons.join(' ') || 'validation.aiQualityPassed'
    await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2 AND business_id=$3', [JSON.stringify(post), postId, business.id])
    await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [business.id])
  })
  return quality
}
