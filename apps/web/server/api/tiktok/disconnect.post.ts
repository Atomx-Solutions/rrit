export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  await withBusinessTransaction(user.id, async (client, business) => { await client.query('DELETE FROM tiktok_connections WHERE business_id=$1', [business.id]) })
  return { disconnected: true }
})
