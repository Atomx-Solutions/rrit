export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  return withBusinessTransaction(user.id, async (client, business) => {
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const running = await client.query(
      "SELECT id FROM publication_jobs WHERE business_id=$1 AND status='processing' LIMIT 1",
      [business.id],
    )
    if (running.rows.length)
      throw createError({
        statusCode: 409,
        message: 'Një postim po publikohet. Prit përfundimin përpara shkëputjes.',
      })
    await client.query(
      "UPDATE publication_jobs SET status='cancelled',updated_at=now() WHERE business_id=$1 AND status='pending'",
      [business.id],
    )
    await client.query(
      "UPDATE posts p SET payload=jsonb_set(payload,'{publicationMode}','\"manual\"'),updated_at=now() WHERE business_id=$1 AND payload->>'status'='scheduled' AND payload->>'publicationMode'='automatic' AND NOT EXISTS (SELECT 1 FROM publication_jobs j WHERE j.post_id=p.id AND j.status IN ('processing','uncertain'))",
      [business.id],
    )
    await client.query('DELETE FROM meta_connections WHERE business_id=$1', [business.id])
    await client.query('DELETE FROM social_posts WHERE business_id=$1', [business.id])
    await client.query(
      "DELETE FROM post_validations WHERE business_id=$1 AND COALESCE(result->>'scope','publication')='publication'",
      [business.id],
    )
    await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [business.id])
    return { disconnected: true }
  })
})
