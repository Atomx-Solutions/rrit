import { adminEmailDomains, listPlatformAdmins } from '../../../utils/admin-platform-admins'

export default defineEventHandler(async (event) => {
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  // The domains let the console say up front which addresses it accepts.
  return { ...(await listPlatformAdmins()), domains: adminEmailDomains(actor.email) }
})
