export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  return withBusinessTransaction(user.id, async (client) => {
    const result = await client.query('SELECT public.client_decline_custom_package_proposal() AS package')
    setHeader(event, 'Cache-Control', 'private, no-store')
    return result.rows[0]?.package
  })
})
