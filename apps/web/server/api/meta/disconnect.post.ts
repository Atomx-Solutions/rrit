import { recordAuditEvent, transitionMetadata } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  return withBusinessTransaction(user.id, async (client, business) => {
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const connection = await client.query<{ id: string; status: string; page_id: string | null; instagram_id: string | null }>(
      'SELECT id,status,page_id,instagram_id FROM meta_connections WHERE business_id=$1 FOR UPDATE',
      [business.id],
    )
    const running = await client.query(
      "SELECT id FROM publication_jobs WHERE business_id=$1 AND status='processing' LIMIT 1",
      [business.id],
    )
    if (running.rows.length)
      throw createError({
        statusCode: 409,
        message: 'server.PUBLICATION_IN_FLIGHT_BLOCKS_DISCONNECT',
      })
    // An Instagram account connected directly through Instagram Login keeps
    // publishing; its jobs carry no page.
    await client.query(
      "UPDATE publication_jobs SET status='cancelled',updated_at=now() WHERE business_id=$1 AND status='pending' AND target_page_id IS NOT NULL",
      [business.id],
    )
    await client.query(
      "UPDATE posts p SET payload=jsonb_set(payload,'{publicationMode}','\"manual\"'),updated_at=now() WHERE business_id=$1 AND payload->>'status'='scheduled' AND payload->>'publicationMode'='automatic' AND (payload->>'channel'<>'Instagram' OR NOT EXISTS (SELECT 1 FROM instagram_connections ic WHERE ic.business_id=p.business_id)) AND NOT EXISTS (SELECT 1 FROM publication_jobs j WHERE j.post_id=p.id AND j.status IN ('processing','uncertain'))",
      [business.id],
    )
    await client.query('DELETE FROM meta_connections WHERE business_id=$1', [business.id])
    await client.query(
      "DELETE FROM social_posts sp WHERE business_id=$1 AND NOT (channel='Instagram' AND EXISTS (SELECT 1 FROM instagram_connections ic WHERE ic.business_id=sp.business_id AND ic.instagram_user_id=sp.source_account_id))",
      [business.id],
    )
    await client.query(
      "DELETE FROM post_validations WHERE business_id=$1 AND COALESCE(result->>'scope','publication')='publication'",
      [business.id],
    )
    await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [business.id])
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: business.id,
      resourceType: 'meta_connection',
      resourceId: connection.rows[0]?.id || business.id,
      action: 'meta.disconnected',
      metadata: transitionMetadata({
        status: [connection.rows[0]?.status || 'not_connected', 'disconnected'],
        page_id: [connection.rows[0]?.page_id || null, null],
        instagram_id: [connection.rows[0]?.instagram_id || null, null],
      }),
    })
    return { disconnected: true }
  })
})
