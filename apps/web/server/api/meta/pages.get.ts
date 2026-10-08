import type { MetaList, MetaPage } from '../../utils/meta'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { business, tokenCiphertext } = await withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query(
      "SELECT token_ciphertext FROM meta_connections WHERE business_id=$1 AND status IN ('pending','connected') AND expires_at>now()",
      [business.id],
    )
    return { business, tokenCiphertext: result.rows[0]?.token_ciphertext as string | undefined }
  })
  if (!tokenCiphertext)
    throw createError({
      statusCode: 409,
      message: 'server.META_CONNECTION_REQUIRED',
    })
  const after = getQuery(event).after
  if (after && (typeof after !== 'string' || after.length > 1000))
    throw createError({ statusCode: 400 })
  try {
    const pages = await graphRequest<MetaList<MetaPage>>(
      'me/accounts',
      decryptMetaToken(tokenCiphertext, business.id),
      {
        fields: 'id,name,access_token,tasks,instagram_business_account{id,username}',
        limit: '50',
        ...(after ? { after: after as string } : {}),
      },
    )
    setHeader(event, 'Cache-Control', 'private, no-store')
    return {
      pages: pages.data.map((page) => ({
        id: page.id,
        name: page.name,
        instagram: page.instagram_business_account || null,
        canCreate: !!page.tasks?.some((task) =>
          [
            'CREATE_CONTENT',
            'MANAGE',
            'PROFILE_PLUS_CREATE_CONTENT',
            'PROFILE_PLUS_FULL_CONTROL',
          ].includes(task),
        ),
      })),
      nextCursor: pages.paging?.next ? pages.paging?.cursors?.after || null : null,
    }
  } catch {
    throw createError({
      statusCode: 502,
      message: 'server.META_PAGES_UNREADABLE',
    })
  }
})
