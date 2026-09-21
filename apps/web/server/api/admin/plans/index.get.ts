import { adminPlansSettings } from '../../../utils/admin-plans'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminPlansSettings()
})
