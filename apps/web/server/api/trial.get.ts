export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const result = await withUserTransaction(user.id, async (client) => {
    const business = await client.query('SELECT id FROM businesses WHERE owner_id = $1', [user.id])
    if (!business.rows[0]) return null
    await setTenantContext(client, { userId: user.id, organizationId: business.rows[0].id })
    return trialStatus(business.rows[0].id, client)
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return result
})
