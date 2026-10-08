import { z } from 'zod'
import { postSchema } from '../../../../shared/schemas/workspace'
import { blockingPostChecks, postContentVersion, tiktokPublishChecks } from '../../../utils/post-validation'
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const business = await withUserTransaction(user.id, (contextClient) =>
    businessForUser(user.id, contextClient),
  )
  const input = z
    .object({ scope: z.enum(['content', 'publication']).default('content') })
    .safeParse(await boundedBody(event, 1024))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'server.VALIDATION_INVALID' })
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404 })
  const { post, contentChecks, checks } = await withBusinessTransaction(
    user.id,
    async (client, currentBusiness) => {
      if (currentBusiness.id !== business.id)
        throw createError({ statusCode: 409, message: 'server.BUSINESS_CHANGED' })
      await requireEntitlement(business.id, 'validation', client)
      const row = await client.query('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [
        id.data,
        business.id,
      ])
      if (!row.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
      const post = postSchema.parse(row.rows[0].payload)
      const contentChecks = await localPostChecks(post, business.id, client)
      const providerChecks =
        input.data.scope === 'publication'
          ? post.channel === 'TikTok'
            ? await tiktokPublishChecks(business.id, client)
            : await providerPostChecks(post, business.id, { db: client })
          : []
      const checks = [...contentChecks, ...providerChecks]
      return { post, contentChecks, checks }
    },
  )
  const contentBlockingChecks = blockingPostChecks(contentChecks)
  const blockingChecks = blockingPostChecks(checks)
  const contentPassed = contentBlockingChecks.every((check) => check.passed)
  const passed = blockingChecks.every((check) => check.passed)
  const advisoryWarnings = checks.filter((check) => check.advisory && !check.passed)
  const result = {
    scope: input.data.scope,
    passed,
    checks,
    checkedAt: new Date().toISOString(),
    manualReview:
      'Konfirmo vetë çmimet, datat, premtimet dhe të drejtat. Kontrollet teknike nuk vërtetojnë saktësinë e këtyre fakteve.',
  }
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const current = await client.query(
      'SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [id.data, business.id],
    )
    if (!current.rows[0] || postFingerprint(current.rows[0].payload) !== postFingerprint(post))
      throw createError({
        statusCode: 409,
        message: 'server.POST_CHANGED_DURING_VALIDATION',
      })
    await client.query(
      'INSERT INTO post_validations (post_id,business_id,post_version,content_version,fingerprint,result) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        post.id,
        business.id,
        post.version,
        postContentVersion(post),
        postFingerprint(post),
        JSON.stringify(result),
      ],
    )
    await client.query(
      "UPDATE posts SET payload=jsonb_set(jsonb_set(payload,'{policy}',to_jsonb($1::text)),'{policyReason}',to_jsonb($2::text)) WHERE id=$3 AND business_id=$4",
      [
        !contentPassed ? 'block' : advisoryWarnings.length ? 'warn' : 'pass',
        contentPassed && !advisoryWarnings.length
          ? 'Kontrollet e përmbajtjes kaluan. Mund ta miratosh dhe ta shtosh në kalendar pa lidhur Meta.'
          : contentChecks
              .filter((check) => !check.passed)
              .map((check) => check.message)
              .join(' '),
        post.id,
        business.id,
      ],
    )
    await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [business.id])
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
