import { z } from 'zod'
import { postSchema } from '../../../../shared/schemas/workspace'
import { recordAuditEvent, transitionMetadata } from '../../../utils/audit'
import { postContentVersion, postFingerprint } from '../../../utils/post-validation'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const business = await withUserTransaction(user.id, (contextClient) =>
    businessForUser(user.id, contextClient),
  )
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const input = z
    .object({ rights: z.literal(false), confirmed: z.literal(true) })
    .safeParse(await boundedBody(event, 1024))
  if (!id.success || !input.success)
    throw createError({ statusCode: 422, message: 'server.RIGHTS_WITHDRAWAL_UNCONFIRMED' })
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    await client.query('SELECT id FROM businesses WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
      business.id,
      user.id,
    ])
    const asset = await client.query(
      'SELECT id,rights FROM assets WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [id.data, business.id],
    )
    if (!asset.rows[0]) throw createError({ statusCode: 404, message: 'server.PHOTO_NOT_FOUND' })
    const image = `/api/media/${id.data}`
    const rows = await client.query(
      "SELECT id,payload FROM posts WHERE business_id=$1 AND payload->>'image'=$2 AND payload->>'status'<>'published' FOR UPDATE",
      [business.id, image],
    )
    const postIds = rows.rows.map((row) => row.id as string)
    const jobs = postIds.length
      ? await client.query(
          "SELECT post_id,status FROM publication_jobs WHERE post_id=ANY($1::uuid[]) AND status IN ('pending','processing','uncertain')",
          [postIds],
        )
      : { rows: [] as { post_id: string; status: string }[] }
    if (postIds.length)
      await client.query(
        "UPDATE publication_jobs SET status='cancelled',failure_code='rights_withdrawn',updated_at=now() WHERE post_id=ANY($1::uuid[]) AND status='pending'",
        [postIds],
      )
    const inFlight = new Set(
      jobs.rows
        .filter((job) => ['processing', 'uncertain'].includes(job.status))
        .map((job) => job.post_id as string),
    )
    for (const row of rows.rows) {
      const post = postSchema.parse(row.payload)
      if (!inFlight.has(post.id)) {
        const previousStatus = post.status
        post.status = 'draft'
        post.scheduledAt = null
        post.publicationMode = 'manual'
        post.policy = 'block'
        post.policyReason =
          'Të drejtat e kësaj fotografie janë tërhequr. Zgjidh një fotografi tjetër.'
        post.version++
        await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2', [
          JSON.stringify(post),
          post.id,
        ])
        await client.query(
          "INSERT INTO post_approval_records(post_id,business_id,content_version,fingerprint,actor_id,decision,source) VALUES($1,$2,$3,$4,$5,'reopened','editor')",
          [post.id, business.id, postContentVersion(post), postFingerprint(post), user.id],
        )
        await recordAuditEvent(client, {
          actorId: user.id,
          organizationId: business.id,
          resourceType: 'post',
          resourceId: post.id,
          action: 'approval.reopened',
          metadata: {
            ...transitionMetadata({ status: [previousStatus, post.status] }),
            contentVersion: postContentVersion(post),
            reason: 'rights_withdrawn',
          },
        })
      }
    }
    await client.query('UPDATE assets SET rights=false WHERE id=$1 AND business_id=$2', [
      id.data,
      business.id,
    ])
    await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [business.id])
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: business.id,
      resourceType: 'asset',
      resourceId: id.data,
      action: 'media.rights_withdrawn',
      metadata: {
        ...transitionMetadata({ rights: [Boolean(asset.rows[0].rights), false] }),
        affectedPosts: rows.rowCount || 0,
      },
    })
    await client.query('COMMIT')
    return { withdrawn: true, affectedPosts: rows.rowCount || 0, inFlight: inFlight.size }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
