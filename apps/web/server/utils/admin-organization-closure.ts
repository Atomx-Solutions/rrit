import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

export const adminCloseOrganizationSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})

// How long a closed organization can still be reopened before its content is
// removed. The platform's policy is 30 days; an environment can set another.
export function organizationClosureGraceDays(env: NodeJS.ProcessEnv = process.env) {
  const configured = Number.parseInt(env.ORGANIZATION_CLOSURE_GRACE_DAYS || '', 10)
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 30
}

// Business-rule failures raised by the closure functions.
const closureFailures: Record<string, { statusCode: number; message: string }> = {
  ORGANIZATION_NOT_FOUND: { statusCode: 404, message: 'server.ORGANIZATION_NOT_FOUND' },
  ORGANIZATION_ALREADY_CLOSED: { statusCode: 409, message: 'server.ORGANIZATION_ALREADY_CLOSED' },
  ORGANIZATION_NOT_CLOSED: { statusCode: 409, message: 'server.ORGANIZATION_NOT_CLOSED' },
  ORGANIZATION_REOPEN_EXPIRED: { statusCode: 409, message: 'server.ORGANIZATION_REOPEN_EXPIRED' },
  ORGANIZATION_WORK_IN_FLIGHT: { statusCode: 409, message: 'server.ORGANIZATION_WORK_IN_FLIGHT' },
  CLOSE_REASON_REQUIRED: { statusCode: 400, message: 'server.CLOSE_REASON_REQUIRED' },
  INVALID_ACTION: { statusCode: 400, message: 'server.ACTION_INVALID' },
}

export function organizationClosureFailure(message: string | undefined) {
  const failure = message ? closureFailures[message] : undefined
  return failure ? { ...failure, code: message! } : null
}

async function callClosure(fn: string, args: Record<string, unknown>) {
  const { data, error } = await adminServiceClient().rpc(fn, args)
  if (error) {
    const failure = organizationClosureFailure(error.message)
    if (failure)
      throw createError({ statusCode: failure.statusCode, message: failure.message, data: { code: failure.code } })
    console.error('Admin organization closure failed.', { fn, code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.ORGANIZATION_NOT_CHANGED' })
  }
  return data as Record<string, unknown>
}

export function closeOrganization(input: {
  organizationId: string
  actor: { id: string; email: string }
  reason: string
}) {
  return callClosure('admin_close_organization', {
    p_organization_id: input.organizationId,
    p_actor_id: input.actor.id,
    p_actor_email: input.actor.email,
    p_reason: input.reason,
    p_grace_days: organizationClosureGraceDays(),
  })
}

export function reopenOrganization(input: { organizationId: string; actor: { id: string; email: string } }) {
  return callClosure('admin_reopen_organization', {
    p_organization_id: input.organizationId,
    p_actor_id: input.actor.id,
    p_actor_email: input.actor.email,
  })
}
