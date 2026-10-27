import { recordAuditEvent, transitionMetadata } from '../../utils/audit'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  return withBusinessTransaction(user.id, async (client, business) => {
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const connection = await client.query<{ id: string; status: string; instagram_user_id: string }>(
      'SELECT id,status,instagram_user_id FROM instagram_connections WHERE business_id=$1 FOR UPDATE',
      [business.id],
    )
    const row = connection.rows[0]
    if (!row) return { disconnected: true }
    // Jobs bound to the directly connected account carry no page.
    const running = await client.query(
      "SELECT id FROM publication_jobs WHERE business_id=$1 AND status='processing' AND target_page_id IS NULL AND target_instagram_id=$2 LIMIT 1",
      [business.id, row.instagram_user_id],
    )
    if (running.rows.length)
      throw createError({ statusCode: 409, message: 'server.PUBLICATION_IN_FLIGHT_BLOCKS_DISCONNECT' })
    const cancelled = await client.query<{ post_id: string }>(
      "UPDATE publication_jobs SET status='cancelled',updated_at=now() WHERE business_id=$1 AND status='pending' AND target_page_id IS NULL AND target_instagram_id=$2 RETURNING post_id",
      [business.id, row.instagram_user_id],
    )
    await client.query(
      "UPDATE posts p SET payload=jsonb_set(payload,'{publicationMode}','\"manual\"'),updated_at=now() WHERE business_id=$1 AND id=ANY($2::uuid[]) AND payload->>'status'='scheduled' AND payload->>'publicationMode'='automatic' AND NOT EXISTS (SELECT 1 FROM publication_jobs j WHERE j.post_id=p.id AND j.status IN ('processing','uncertain'))",
      [business.id, cancelled.rows.map((job) => job.post_id)],
    )
    await client.query('DELETE FROM instagram_connections WHERE business_id=$1', [business.id])
    // Posts of the same account stay when the Facebook page still links it.
    await client.query(
      "DELETE FROM social_posts WHERE business_id=$1 AND channel='Instagram' AND source_account_id=$2 AND NOT EXISTS (SELECT 1 FROM meta_connections mc WHERE mc.business_id=$1 AND mc.instagram_id=$2)",
      [business.id, row.instagram_user_id],
    )
    await client.query(
      "DELETE FROM post_validations WHERE business_id=$1 AND COALESCE(result->>'scope','publication')='publication'",
      [business.id],
    )
    await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [business.id])
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: business.id,
      resourceType: 'instagram_connection',
      resourceId: row.id,
      action: 'instagram.disconnected',
      metadata: transitionMetadata({
        status: [row.status, 'disconnected'],
        instagram_id: [row.instagram_user_id, null],
      }),
    })
    return { disconnected: true }
  })
})
