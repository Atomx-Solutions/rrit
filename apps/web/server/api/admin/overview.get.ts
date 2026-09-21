import { adminOverview } from '../../utils/admin-overview'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const startedAt = performance.now()
  const overview = await adminOverview()
  setHeader(event, 'Server-Timing', `overview;dur=${Math.round(performance.now() - startedAt)}`)
  return overview
})
