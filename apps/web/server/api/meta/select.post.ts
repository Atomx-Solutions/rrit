import { z } from 'zod'
import type { MetaPage } from '../../utils/meta'
import { recordAuditEvent, transitionMetadata } from '../../utils/audit'
import { reconnectionMatchesTargets } from '../../utils/publishing'
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const business = await withUserTransaction(user.id, (client) => businessForUser(user.id, client))
  const input = z
    .object({ pageId: z.string().regex(/^\d+$/) })
    .safeParse(await boundedBody(event, 1024))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'server.PAGE_INVALID' })
  const stored = await withBusinessTransaction(user.id, async (client, currentBusiness) => {
    if (currentBusiness.id !== business.id)
      throw createError({ statusCode: 409, message: 'server.BUSINESS_CHANGED_PAGE_SELECTION' })
    return client.query(
    "SELECT token_ciphertext,status,page_id,instagram_id FROM meta_connections WHERE business_id=$1 AND status IN ('pending','connected') AND expires_at>now()",
    [business.id],
    )
  })
  if (!stored.rows[0])
    throw createError({ statusCode: 409, message: 'server.META_RECONNECT_REQUIRED' })
  // The page is resolved with this user's verified token, never a token supplied by the browser.
  let page: MetaPage
  try {
    page = await graphRequest<MetaPage>(
      input.data.pageId,
      decryptMetaToken(stored.rows[0].token_ciphertext, business.id),
      { fields: 'id,name,access_token,instagram_business_account{id,username}' },
    )
  } catch {
    throw createError({ statusCode: 403, message: 'server.PAGE_ACCESS_UNCONFIRMED' })
  }
  if (
    page.id !== input.data.pageId ||
    !page.access_token
  )
    throw createError({
      statusCode: 403,
      message: 'server.PAGE_CREATE_PERMISSION_REQUIRED',
    })
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const jobs = await client.query(
      "SELECT status,target_page_id,target_instagram_id FROM publication_jobs WHERE business_id=$1 AND status IN ('pending','processing','uncertain')",
      [business.id],
    )
    if (
      jobs.rows.length &&
      !reconnectionMatchesTargets(
        jobs.rows,
        page.id,
        page.instagram_business_account?.id || null,
      )
    )
      throw createError({
        statusCode: 409,
        data: { code: 'PAGE_ALREADY_CONNECTED' },
        message:
          'server.PREVIOUS_PAGE_PUBLICATION_PENDING',
      })
    await client.query(
      "DELETE FROM post_validations WHERE business_id=$1 AND COALESCE(result->>'scope','publication')='publication'",
      [business.id],
    )
    const locked = await client.query(
      "SELECT id FROM meta_connections WHERE business_id=$1 AND token_ciphertext=$2 AND status IN ('pending','connected') AND expires_at>now() FOR UPDATE",
      [business.id, stored.rows[0].token_ciphertext],
    )
    if (!locked.rows.length)
      throw createError({
        statusCode: 409,
        message: 'server.AUTHORIZATION_CHANGED',
      })
    await claimSocialTrialIdentities(client, business.id, [
      { kind: 'facebook_page', value: page.id },
      ...(page.instagram_business_account
        ? [{ kind: 'instagram_account' as const, value: page.instagram_business_account.id }]
        : []),
    ])
    await client.query(
      "UPDATE meta_connections SET status='connected',page_id=$1,page_name=$2,page_token_ciphertext=$3,instagram_id=$4,instagram_username=$5,updated_at=now() WHERE business_id=$6",
      [
        page.id,
        page.name,
        encryptMetaToken(page.access_token, business.id),
        page.instagram_business_account?.id || null,
        page.instagram_business_account?.username || null,
        business.id,
      ],
    )
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: business.id,
      resourceType: 'meta_connection',
      resourceId: locked.rows[0].id as string,
      action: 'meta.connected',
      metadata: {
        ...transitionMetadata({
          status: [stored.rows[0].status as string, 'connected'],
          page_id: [(stored.rows[0].page_id as string | null) || null, page.id],
          instagram_id: [
            (stored.rows[0].instagram_id as string | null) || null,
            page.instagram_business_account?.id || null,
          ],
        }),
      },
    })
    await client.query(
      "DELETE FROM social_posts WHERE business_id=$1 AND NOT ((channel='Facebook' AND source_account_id=$2) OR (channel='Instagram' AND source_account_id=$3))",
      [business.id, page.id, page.instagram_business_account?.id || ''],
    )
    await client.query('COMMIT')
    return { connected: true }
  } catch (error) {
    await client.query('ROLLBACK')
    if ((error as { code?: string }).code === '23505')
      throw createError({
        statusCode: 409,
        message: 'server.PAGE_LINKED_TO_OTHER_BUSINESS',
      })
    throw error
  } finally {
    client.release()
  }
})
