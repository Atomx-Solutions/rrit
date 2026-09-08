import { z } from 'zod'
import { postSchema } from '../../../../shared/schemas/workspace'
import { postContentVersion } from '../../../utils/post-validation'
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const business = await businessForUser(user.id)
  await requireEntitlement(business.id, 'validation')
  const input = z
    .object({ scope: z.enum(['content', 'publication']).default('content') })
    .safeParse(await boundedBody(event, 1024))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'Zgjidh një kontroll të vlefshëm.' })
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404 })
  const row = await database().query('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [
    id.data,
    business.id,
  ])
  if (!row.rows[0]) throw createError({ statusCode: 404, message: 'Postimi nuk u gjet.' })
  const post = postSchema.parse(row.rows[0].payload)
  const contentChecks = await localPostChecks(post, business.id)
  const checks = [
    ...contentChecks,
    ...(input.data.scope === 'publication' ? await providerPostChecks(post, business.id) : []),
  ]
  const contentPassed = contentChecks.every((check) => check.passed)
  const result = {
    scope: input.data.scope,
    passed: checks.every((check) => check.passed),
    checks,
    checkedAt: new Date().toISOString(),
    manualReview:
      'Konfirmo vetë çmimet, datat, premtimet dhe të drejtat. Kontrollet teknike nuk vërtetojnë saktësinë e këtyre fakteve.',
  }
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const current = await client.query(
      'SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [id.data, business.id],
    )
    if (!current.rows[0] || postFingerprint(current.rows[0].payload) !== postFingerprint(post))
      throw createError({
        statusCode: 409,
        message: 'Postimi ndryshoi gjatë kontrollit. Kontrolloje përsëri.',
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
        contentPassed ? 'pass' : 'block',
        contentPassed
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
