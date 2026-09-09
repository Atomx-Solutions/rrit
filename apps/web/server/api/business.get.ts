export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  const business = await withUserTransaction(user.id, async (client) => {
    const result = await client.query('SELECT id FROM businesses WHERE owner_id = $1', [user.id])
    if (!result.rows[0]) return null
    await setTenantContext(client, { userId: user.id, organizationId: result.rows[0].id })
    return loadWorkspace(client, result.rows[0].id, user.id)
  })
  return {
    user: { id: user.id, name: user.name, email: user.email },
    business,
  }
})
