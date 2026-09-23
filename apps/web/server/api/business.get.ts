import { getBrandForBusiness } from '../utils/brands'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  const business = await withUserTransaction(user.id, async (client) => {
    const result = await client.query('SELECT id FROM businesses WHERE owner_id = $1', [user.id])
    if (!result.rows[0]) return null
    await setTenantContext(client, { userId: user.id, organizationId: result.rows[0].id })
    const business = await loadWorkspace(client, result.rows[0].id, user.id)
    const brand = await getBrandForBusiness(client, result.rows[0].id, business.slug)
    if (brand) {
      business.workspace.brandRevision = brand.revision
      business.workspace.brand.status = brand.status
    }
    return { ...business, brand }
  })
  return {
    user: { id: user.id, name: user.name, email: user.email },
    business,
  }
})
