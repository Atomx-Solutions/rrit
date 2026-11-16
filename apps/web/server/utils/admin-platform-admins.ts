import { createError } from 'h3'
import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'
import { authConfiguration } from './auth-configuration'

export interface PlatformAdmin {
  user_id: string
  email: string
  name: string
  granted_at: string
  granted_by_email: string | null
  last_sign_in_at: string | null
  microsoft: boolean
}

/** The console's languages; the invitation email is written in both. */
export const ADMIN_INVITE_LOCALES = ['sq', 'en'] as const
export type AdminInviteLocale = typeof ADMIN_INVITE_LOCALES[number]

/** Where the invitation link lands: the console's own sign-in page. */
export const ADMIN_SIGN_IN_PATH = '/admin/login'

// Read by the Supabase "Invite user" template (docs/email-templates) as
// {{ .Data.<key> }}. Supabase stores them in the account's user metadata.
export const ADMIN_INVITE_DATA = { invitedBy: 'admin_invited_by', locale: 'admin_invite_locale' } as const

const inviteLocale = z.enum(ADMIN_INVITE_LOCALES).default(ADMIN_INVITE_LOCALES[0])

export const adminEmailSchema = z.object({ email: z.email().max(320), locale: inviteLocale }).strict()
export const adminInviteSchema = z.object({ locale: inviteLocale }).strict()

/**
 * What happened to the invitation email. Supabase sends an invitation only to
 * an address without a confirmed account, so an existing account gets none.
 */
export type InviteDelivery = 'sent' | 'existing_account' | 'failed'

// Business-rule refusals from the database, each with a stable code the
// console turns into its own message.
const failures: Record<string, number> = {
  SUPERADMIN_REQUIRED: 403,
  ADMIN_ACCOUNT_NOT_FOUND: 404,
  ADMIN_ALREADY_EXISTS: 409,
  ADMIN_EMAIL_DOMAIN_NOT_ALLOWED: 422,
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

function emailDomain(email: string) {
  return email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase()
}

/**
 * The company domains an administrator's address may use. ADMIN_EMAIL_DOMAINS
 * lists them when the company has several; otherwise it is the domain of the
 * administrator who adds, who has signed in with the company Microsoft account.
 */
export function adminEmailDomains(actorEmail: string) {
  const configured = (process.env.ADMIN_EMAIL_DOMAINS ?? '')
    .split(',')
    .map(domain => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  return configured.length ? [...new Set(configured)] : [emailDomain(actorEmail)]
}

/** Refuses an address outside the company before any account or email exists. */
export function requireCompanyEmail(actorEmail: string, email: string) {
  const domains = adminEmailDomains(actorEmail)
  if (domains.includes(emailDomain(email))) return
  throw createError({
    statusCode: 422,
    message: 'server.REQUEST_DENIED',
    data: { code: 'ADMIN_EMAIL_DOMAIN_NOT_ALLOWED', domains },
  })
}

/** Whether an Auth error says the address already has an account. */
export function accountAlreadyExists(error: { code?: string; status?: number; message?: string }) {
  return error.code === 'email_exists'
    || error.status === 422
    || (error.message ?? '').toLowerCase().includes('already')
}

/**
 * Asks Supabase to email the address its "Invite user" template, sent through
 * the project's own SMTP (Brevo). The invitation also creates the account when
 * the address has none; its owner still gets in only through the company
 * Microsoft sign-in, which Supabase links to it once the invitation confirmed
 * the address.
 */
async function inviteAccount(actor: { email: string }, email: string, locale: AdminInviteLocale): Promise<InviteDelivery> {
  const { error } = await adminServiceClient().auth.admin.inviteUserByEmail(email, {
    redirectTo: `${authConfiguration().baseURL}${ADMIN_SIGN_IN_PATH}`,
    data: { [ADMIN_INVITE_DATA.invitedBy]: actor.email, [ADMIN_INVITE_DATA.locale]: locale },
  })
  if (!error) return 'sent'
  if (accountAlreadyExists(error)) return 'existing_account'
  console.error('Administrator invitation email failed.', { status: error.status, code: error.code })
  return 'failed'
}

/**
 * Makes sure the address has an account the role can attach to when the
 * invitation could not create one. A new one has no password and is marked as
 * confirmed, so the first Microsoft sign-in links to it.
 */
async function ensureAccount(email: string) {
  const { error } = await adminServiceClient().auth.admin.createUser({ email, email_confirm: true })
  if (!error || accountAlreadyExists(error)) return
  console.error('Administrator account creation failed.', { status: error.status, code: error.code })
  throw createError({ statusCode: 502, message: 'server.REQUEST_DENIED' })
}

/**
 * Gives the address the superadmin role at once and emails the invitation. A
 * failed email never blocks the role: the console reports it and offers to
 * send it again.
 */
export async function grantPlatformAdmin(
  actor: { id: string; email: string },
  email: string,
  locale: AdminInviteLocale,
) {
  requireCompanyEmail(actor.email, email)
  const invite = await inviteAccount(actor, email, locale)
  if (invite === 'failed') await ensureAccount(email)
  const granted = await rpc<{ user_id: string; email: string }>('admin_grant_superadmin', {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_email: email,
  })
  return { ...granted, invite }
}

/**
 * Sends the invitation again to an administrator who already holds the role.
 * Supabase repeats it until the link is opened; after that the account is
 * confirmed and the answer is "existing_account".
 */
export async function resendAdminInvite(actor: { email: string }, userId: string, locale: AdminInviteLocale) {
  const { administrators } = await listPlatformAdmins()
  const admin = administrators.find(entry => entry.user_id === userId)
  if (!admin)
    throw createError({ statusCode: 404, message: 'server.REQUEST_DENIED', data: { code: 'ADMIN_NOT_FOUND' } })
  requireCompanyEmail(actor.email, admin.email)
  return { user_id: admin.user_id, email: admin.email, invite: await inviteAccount(actor, admin.email, locale) }
}

export function revokePlatformAdmin(actor: { id: string; email: string }, userId: string) {
  return rpc<{ user_id: string; email: string }>('admin_revoke_superadmin', {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_user_id: userId,
  })
}
