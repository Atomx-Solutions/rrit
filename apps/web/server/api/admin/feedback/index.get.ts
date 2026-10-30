import { adminClientFeedback } from '../../../utils/client-feedback'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminClientFeedback()
})
