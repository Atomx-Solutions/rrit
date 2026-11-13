import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

export interface PlatformAdmin {
  user_id: string
  email: string
  name: string
  granted_at: string
  granted_by_email: string | null
  last_sign_in_at: string | null
  microsoft: boolean
}

export const adminEmailSchema = z.object({ email: z.email().max(320) }).strict()

// Business-rule refusals from the database, each with a stable code the
// console turns into its own message.
const failures: Record<string, number> = {
  SUPERADMIN_REQUIRED: 403,
  ADMIN_ACCOUNT_NOT_FOUND: 404,
  ADMIN_ALREADY_EXISTS: 409,
  ADMIN_CANNOT_REMOVE_SELF: 409,
  ADMIN_LAST_REMAINING: 409,
  ADMIN_NOT_FOUND: 404,
}

export function platformAdminFailure(message: string | undefined) {
  const code = message ? Object.keys(failures).find(key => message.includes(key)) : undefined
  return code ? { code, statusCode: failures[code]! } : null
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await adminServiceClient().rpc(name, args)
  if (error) {
    const failure = platformAdminFailure(error.message)
    if (failure)
      throw createError({
        statusCode: failure.statusCode,
        message: 'server.REQUEST_DENIED',
        data: { code: failure.code },
      })
    console.error('Platform admin call failed.', { name, code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.REQUEST_DENIED' })
  }
  return data as T
}

export async function listPlatformAdmins() {
  return { administrators: await rpc<PlatformAdmin[]>('admin_list_platform_admins', {}) }
}

/** Whether an Auth error says the address already has an account. */
export function accountAlreadyExists(error: { code?: string; status?: number; message?: string }) {
  return error.code === 'email_exists'
    || error.status === 422
    || (error.message ?? '').toLowerCase().includes('already')
}

/**
 * Makes sure the address has an account the role can attach to. A new one
 * has no password: its owner gets in only through the company Microsoft
 * sign-in, which Supabase links to it on first use because the address is
 * marked as confirmed.
 */
async function ensureAccount(email: string) {
  const { error } = await adminServiceClient().auth.admin.createUser({ email, email_confirm: true })
  if (!error || accountAlreadyExists(error)) return
  console.error('Administrator account creation failed.', { status: error.status, code: error.code })
  throw createError({ statusCode: 502, message: 'server.REQUEST_DENIED' })
}

/** Gives the address the superadmin role at once, creating its account if needed. */
export async function grantPlatformAdmin(actor: { id: string; email: string }, email: string) {
  await ensureAccount(email)
  return rpc<{ user_id: string; email: string }>('admin_grant_superadmin', {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_email: email,
  })
}

export function revokePlatformAdmin(actor: { id: string; email: string }, userId: string) {
  return rpc<{ user_id: string; email: string }>('admin_revoke_superadmin', {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_user_id: userId,
  })
}
