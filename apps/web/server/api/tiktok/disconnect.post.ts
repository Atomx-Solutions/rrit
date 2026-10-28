export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  await withBusinessTransaction(user.id, async (client, business) => {
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const running = await client.query(
      "SELECT id FROM publication_jobs WHERE business_id=$1 AND status='processing' AND target_tiktok_open_id IS NOT NULL LIMIT 1",
      [business.id],
    )
    if (running.rows.length)
      throw createError({ statusCode: 409, message: 'server.PUBLICATION_IN_FLIGHT_BLOCKS_DISCONNECT' })
    // Pending direct posts are cancelled; their posts stay in the calendar as manual.
    const cancelled = await client.query<{ post_id: string }>(
      "UPDATE publication_jobs SET status='cancelled',updated_at=now() WHERE business_id=$1 AND status='pending' AND target_tiktok_open_id IS NOT NULL RETURNING post_id",
      [business.id],
    )
    await client.query(
      "UPDATE posts p SET payload=jsonb_set(payload,'{publicationMode}','\"manual\"'),updated_at=now() WHERE business_id=$1 AND id=ANY($2::uuid[]) AND payload->>'status'='scheduled' AND payload->>'publicationMode'='automatic' AND NOT EXISTS (SELECT 1 FROM publication_jobs j WHERE j.post_id=p.id AND j.status IN ('processing','uncertain'))",
      [business.id, cancelled.rows.map((job) => job.post_id)],
    )
    await client.query('DELETE FROM tiktok_connections WHERE business_id=$1', [business.id])
    if (cancelled.rows.length) await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [business.id])
  })
  return { disconnected: true }
})
