import {
  adminPackageRequests,
  packageRequestStatusSchema,
} from '../../../utils/admin-package-requests'

export default defineEventHandler(async (event) => {
  const status = packageRequestStatusSchema.safeParse(getQuery(event).status)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminPackageRequests(status.success ? status.data : undefined)
})
