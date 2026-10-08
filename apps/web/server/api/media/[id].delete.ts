import { z } from 'zod'
import { recordAuditEvent } from '../../utils/audit'
import { removeAsset } from '../../utils/asset-storage'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const business = await withUserTransaction(user.id, (contextClient) =>
    businessForUser(user.id, contextClient),
  )
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'server.PHOTO_NOT_FOUND' })

  const client = await database().connect()
  let storagePath: string | null | undefined
  try {
    await client.query('BEGIN')
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    const asset = await client.query<{ id: string, storage_path: string | null }>(
      'SELECT id,storage_path FROM assets WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [id.data, business.id],
    )
    if (!asset.rows[0]) throw createError({ statusCode: 404, message: 'server.PHOTO_NOT_FOUND' })

    const image = `/api/media/${id.data}`
    const used = await client.query(
      "SELECT 1 FROM posts WHERE business_id=$1 AND payload->>'image'=$2 LIMIT 1",
      [business.id, image],
    )
    if (used.rows.length)
      throw createError({
        statusCode: 409,
        message: 'server.PHOTO_USED_BY_POST',
        data: { code: 'ASSET_IN_USE' },
      })

    await client.query('DELETE FROM assets WHERE id=$1 AND business_id=$2', [id.data, business.id])
    await client.query('UPDATE businesses SET revision=revision+1,updated_at=now() WHERE id=$1', [business.id])
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: business.id,
      resourceType: 'asset',
      resourceId: id.data,
      action: 'media.deleted',
      metadata: {},
    })
    storagePath = asset.rows[0].storage_path
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  if (storagePath) {
    try {
      await removeAsset(storagePath)
    } catch (error) {
      console.error('Failed to remove deleted asset from storage', { assetId: id.data, error })
    }
  }
  return { removed: true, id: id.data }
})
