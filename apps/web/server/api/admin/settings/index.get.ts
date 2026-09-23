import { platformSettings } from '../../../utils/admin-settings'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return platformSettings()
})
