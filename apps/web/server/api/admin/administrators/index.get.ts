import { listPlatformAdmins } from '../../../utils/admin-platform-admins'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return listPlatformAdmins()
})
