import { packageRequestPostOptions } from '../utils/package-requests'

// The amounts the public form offers as a starting point. They are a setting,
// so the form never carries a list of its own.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { postOptions: await packageRequestPostOptions() }
})
