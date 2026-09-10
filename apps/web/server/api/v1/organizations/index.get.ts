import { listOrganizationsForUser } from '../../../utils/organizations'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return await listOrganizationsForUser(user.id)
})
