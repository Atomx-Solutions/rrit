// A light check that the signed-in account's organization is still open, so an
// open page notices a closure without waiting for the next real request.
// setTenantContext refuses a closed organization with ORGANIZATION_CLOSED.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  await withUserTransaction(user.id, async (client) => {
    const result = await client.query<{ id: string }>('SELECT id FROM businesses WHERE owner_id = $1', [user.id])
    if (result.rows[0]) await setTenantContext(client, { userId: user.id, organizationId: result.rows[0].id })
  })
  return { ok: true as const }
})
