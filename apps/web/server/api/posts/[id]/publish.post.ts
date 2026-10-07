import { z } from 'zod'
import { postSchema } from '../../../../shared/schemas/workspace'
import { requireCurrentApproval } from '../../../utils/post-validation'
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const business = await withUserTransaction(user.id, (contextClient) =>
    businessForUser(user.id, contextClient),
  )
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const input = z
    .object({ confirmed: z.literal(true), version: z.number().int().positive() })
    .safeParse(await boundedBody(event, 1024))
  if (!id.success || !input.success)
    throw createError({ statusCode: 422, message: 'server.PUBLISH_CONFIRM_REQUIRED' })
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const logicalKey = publicationLogicalKey(business.id, id.data, input.data.version)
    const replay = await client.query(
      'SELECT id,status FROM publication_jobs WHERE business_id=$1 AND logical_key=$2',
      [business.id, logicalKey],
    )
    if (replay.rows[0]) {
      await client.query('COMMIT')
      return {
        queued: true,
        idempotentReplay: true,
        jobId: replay.rows[0].id as string,
        status: replay.rows[0].status as string,
      }
    }
    await requireEntitlement(business.id, 'publishing', client)
    await requirePublishingWorker(client)
    const row = await client.query(
      'SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [id.data, business.id],
    )
    if (!row.rows[0]) throw createError({ statusCode: 404 })
    const post = postSchema.parse(row.rows[0].payload)
    if (post.status !== 'approved' || post.version !== input.data.version)
      throw createError({
        statusCode: 409,
        message: 'server.POST_MUST_BE_APPROVED',
      })
    await requireCurrentApproval(post, business.id, client)
    await requireFreshValidation(post, business.id, client, 'publication')
    const unresolved = await client.query(
      "SELECT id FROM publication_jobs WHERE post_id=$1 AND status IN ('pending','processing','uncertain')",
      [post.id],
    )
    if (unresolved.rows.length)
      throw createError({
        statusCode: 409,
        message: 'server.POST_ALREADY_IN_PROGRESS',
      })
    post.status = 'scheduled'
    post.publicationMode = 'automatic'
    post.scheduledAt = new Date().toISOString()
    post.version++
    const job = await queuePublication(client, post, business.id, post.scheduledAt, logicalKey)
    await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2', [
      JSON.stringify(post),
      post.id,
    ])
    await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [business.id])
    await client.query('COMMIT')
    return { queued: true, idempotentReplay: false, jobId: job.id, status: job.status }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
