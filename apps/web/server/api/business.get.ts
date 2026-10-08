import { getBrandForBusiness } from '../utils/brands'

export default defineEventHandler(async (event) => {
  const timings: string[] = []
  const measure = (name: string, startedAt: number) => {
    timings.push(`${name};dur=${(performance.now() - startedAt).toFixed(1)}`)
  }
  let startedAt = performance.now()
  const user = await requireUser(event)
  measure('auth', startedAt)
  setHeader(event, 'Cache-Control', 'private, no-store')
  startedAt = performance.now()
  const business = await withUserTransaction(user.id, async (client) => {
    let stepStartedAt = performance.now()
    const result = await client.query(
      'SELECT id, owner_id, slug, state, revision FROM businesses WHERE owner_id = $1',
      [user.id],
    )
    measure('businessLookup', stepStartedAt)
    if (!result.rows[0]) return null
    stepStartedAt = performance.now()
    await setTenantContext(client, { userId: user.id, organizationId: result.rows[0].id })
    measure('tenantContext', stepStartedAt)
    stepStartedAt = performance.now()
    const business = await loadWorkspace(client, result.rows[0].id, user.id, result.rows[0], (phase, durationMs) => {
      timings.push(`${phase};dur=${durationMs.toFixed(1)}`)
    })
    measure('workspace', stepStartedAt)
    stepStartedAt = performance.now()
    const brand = await getBrandForBusiness(client, result.rows[0].id, business.slug)
    measure('brand', stepStartedAt)
    if (brand) {
      business.workspace.brandRevision = brand.revision
      business.workspace.brand.status = brand.status
    }
    return { ...business, brand }
  }, (phase, durationMs) => {
    timings.push(`${phase};dur=${durationMs.toFixed(1)}`)
  })
  measure('databaseTotal', startedAt)
  setHeader(event, 'Server-Timing', timings.join(', '))
  return {
    user: { id: user.id, name: user.name, email: user.email },
    business,
  }
})
