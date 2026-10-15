import { z } from 'zod'
import { adminServiceClient } from '../../utils/admin-supabase'
import { visitorHash } from '../../utils/package-requests'

const bodySchema = z.object({ email: z.email().max(320) })

// Lookups allowed per visitor and hour; configurable because it trades how
// helpful the forms are against how easily addresses can be probed.
function hourlyLimit() {
  const configured = Number(process.env.AUTH_EMAIL_LOOKUP_HOURLY_LIMIT)
  return Number.isInteger(configured) && configured > 0 ? configured : 10
}

// Tells the sign-in and recovery forms whether an address has an account, so
// a visitor who never registered is sent to sign-up instead of an inbox.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const body = bodySchema.safeParse(await boundedBody(event, 1024))
  if (!body.success)
    throw createError({ statusCode: 400, message: 'server.VALUES_INVALID', data: { code: 'INVALID_BODY' } })
  setHeader(event, 'Cache-Control', 'private, no-store')
  const { data, error } = await adminServiceClient().rpc('auth_email_registered', {
    p_email: body.data.email,
    p_submitter_hash: visitorHash(event, 'email-lookup'),
    p_hourly_limit: hourlyLimit(),
  })
  if (error) {
    if (error.message === 'EMAIL_LOOKUP_RATE_LIMITED')
      throw createError({ statusCode: 429, message: 'auth.rateLimitError', data: { code: 'RATE_LIMITED' } })
    console.error('Email lookup failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.REQUEST_DENIED' })
  }
  return { registered: data === true }
})
