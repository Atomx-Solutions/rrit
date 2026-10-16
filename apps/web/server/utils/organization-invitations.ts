import { createHash, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { organizationNameSchema, organizationSlugSchema } from '../../shared/schemas/organization'
import { emptyWorkspace } from '../../shared/utils/empty-workspace'
import {
  hasPasswordSymbol,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../shared/utils/password-policy'
import { adminServiceClient } from './admin-supabase'
import { setTenantContext, withUserTransaction } from './database'
import { deviceIdentity, grantTrial } from './trials'

// The invited client receives the token once, inside a link. Only its hash
// reaches the database, so a database read can never rebuild a working token.
const TOKEN_BYTES = 32
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

// A preview carries no tenant data, so it runs under a fixed id that belongs to
// nobody rather than widening the runtime role to unauthenticated sessions.
const ANONYMOUS_PREVIEW_USER = '00000000-0000-0000-0000-000000000000'

export function createInvitationToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function invitationTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function invitationUrl(token: string) {
  const base = process.env.APP_URL
  if (!base) throw createError({ statusCode: 503, message: 'server.APP_URL_NOT_SET' })
  const url = new URL('/join', base)
  url.searchParams.set('token', token)
  return url.toString()
}

export const invitationRoleSchema = z.enum([
  'owner',
  'admin',
  'marketer',
  'approver',
  'analyst',
  'billing',
])

export const invitationProfileSchema = z
  .object({
    businessName: z.string().trim().max(120).optional(),
    contactName: z.string().trim().max(120).optional(),
    city: z.string().trim().max(120).optional(),
    industry: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
  })
  .strict()

export const invitationCreateSchema = z
  .object({
    name: organizationNameSchema,
    slug: organizationSlugSchema,
    email: z.email().max(320),
    role: invitationRoleSchema.default('owner'),
    package_request_id: z.uuid().optional(),
    expires_minutes: z.number().int().min(1).max(1440).default(60),
    profile: invitationProfileSchema.default({}),
  })
  .strict()

export const invitationResendSchema = z
  .object({ expires_minutes: z.number().int().min(1).max(1440).default(60) })
  .strict()

export const invitationTokenBodySchema = z.object({ token: tokenSchema }).strict()

// An invited address was supplied by the superadmin, not claimed by a stranger,
// so the account is created already confirmed and the client never waits for a
// verification email. Self-service registration keeps the normal confirmation.
export const invitationRegisterSchema = z
  .object({
    token: tokenSchema,
    name: z.string().trim().min(2).max(100),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH)
      .max(PASSWORD_MAX_LENGTH)
      .refine(hasPasswordSymbol),
  })
  .strict()

const failures: Record<string, { statusCode: number; message: string }> = {
  INVITATION_INVALID: { statusCode: 400, message: 'server.INVITATION_DATA_INVALID' },
  INVITATION_NOT_FOUND: { statusCode: 404, message: 'server.INVITATION_NOT_FOUND' },
  INVITATION_CLOSED: { statusCode: 409, message: 'server.INVITATION_CLOSED' },
  INVITATION_EXPIRED: { statusCode: 410, message: 'server.INVITATION_EXPIRED' },
  INVITATION_EMAIL_MISMATCH: {
    statusCode: 403,
    message: 'server.INVITATION_EMAIL_MISMATCH',
  },
  ACCOUNT_EXISTS: {
    statusCode: 409,
    message: 'server.EMAIL_ALREADY_HAS_ACCOUNT',
  },
  PASSWORD_WEAK: {
    statusCode: 422,
    message: 'server.PASSWORD_REQUIREMENTS_NOT_MET',
  },
  BUSINESS_EXISTS: {
    statusCode: 409,
    message: 'server.ACCOUNT_HAS_BUSINESS',
  },
  ORGANIZATION_SLUG_TAKEN: { statusCode: 409, message: 'server.ORGANIZATION_SLUG_EXISTS' },
  AUTH_REQUIRED: { statusCode: 401, message: 'server.LOGIN_REQUIRED' },
}

export function invitationFailure(message: string | undefined) {
  const failure = message ? failures[message] : undefined
  return failure ? { ...failure, code: message! } : null
}

function raise(message: string | undefined, fallback: string): never {
  const failure = invitationFailure(message)
  if (failure)
    throw createError({
      statusCode: failure.statusCode,
      message: failure.message,
      data: { code: failure.code },
    })
  throw createError({ statusCode: 502, message: fallback })
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await adminServiceClient().rpc(name, args)
  if (error) {
    if (!invitationFailure(error.message))
      console.error('Organization invitation call failed.', {
        name,
        code: error.code,
        message: error.message,
      })
    raise(error.message, 'Ftesa nuk u ruajt.')
  }
  return data as Record<string, unknown>
}

export async function createOrganizationInvitation(
  actor: { id: string; email: string },
  values: z.infer<typeof invitationCreateSchema>,
) {
  const token = createInvitationToken()
  const result = await rpc('admin_create_organization_invitation', {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_invitation: { ...values, token_hash: invitationTokenHash(token) },
  })
  // The one moment the token exists outside the link the superadmin sends.
  return { ...result, url: invitationUrl(token) }
}

export function listOrganizationInvitations(organizationId?: string) {
  return rpc('admin_organization_invitations', { p_organization_id: organizationId ?? null })
}

export function revokeOrganizationInvitation(
  invitationId: string,
  actor: { id: string; email: string },
) {
  return rpc('admin_revoke_organization_invitation', {
    p_invitation_id: invitationId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
  })
}

export function deleteOrganizationInvitation(invitationId: string, actor: { id: string; email: string }) {
  return rpc('admin_delete_organization_invitation', {
    p_invitation_id: invitationId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
  })
}

export async function resendOrganizationInvitation(
  invitationId: string,
  actor: { id: string; email: string },
  values: z.infer<typeof invitationResendSchema>,
) {
  const token = createInvitationToken()
  const result = await rpc('admin_resend_organization_invitation', {
    p_invitation_id: invitationId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_token_hash: invitationTokenHash(token),
    p_expires_minutes: values.expires_minutes,
  })
  return { ...result, url: invitationUrl(token) }
}

export type InvitationPreview =
  | { valid: false }
  | {
      valid: true
      organizationName: string
      email: string
      profile: Record<string, string | undefined>
      expiresAt: string
    }

async function readPreview(client: PoolClient, tokenHash: string) {
  const result = await client.query<{ preview: InvitationPreview | null }>(
    'SELECT public.organization_invitation_preview($1) AS preview',
    [tokenHash],
  )
  return result.rows[0]?.preview ?? { valid: false as const }
}

// The database function decides what a visitor may learn from a token; the
// server never reads the invitation table directly.
export function previewInvitation(token: string, userId?: string) {
  const hash = invitationTokenHash(token)
  return withUserTransaction(userId || ANONYMOUS_PREVIEW_USER, (client) =>
    readPreview(client, hash),
  )
}

// Creating the account here, rather than through the browser's sign-up, is what
// lets an invited client skip verification: the superadmin already vouched for
// the address. The token is the only thing that proves the invitation, so the
// account is created only for the address that token was issued to.
export async function registerInvitedClient(input: {
  token: string
  name: string
  password: string
}) {
  const preview = await previewInvitation(input.token)
  if (!preview.valid) raise('INVITATION_NOT_FOUND', 'server.ACCOUNT_NOT_CREATED')

  const { data, error } = await adminServiceClient().auth.admin.createUser({
    email: preview.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name },
  })
  if (error) {
    const message = error.message.toLowerCase()
    if (message.includes('already') || error.status === 422)
      raise('ACCOUNT_EXISTS', 'server.ACCOUNT_NOT_CREATED')
    if (message.includes('password')) raise('PASSWORD_WEAK', 'server.ACCOUNT_NOT_CREATED')
    console.error('Invited client registration failed.', {
      status: error.status,
      code: error.code,
    })
    throw createError({ statusCode: 502, message: 'server.ACCOUNT_NOT_CREATED' })
  }
  // The browser signs in with the same password straight after; the server
  // never hands out a session of its own.
  return { email: preview.email, userId: data.user?.id }
}

export function businessSlugFromName(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70)
    .padEnd(2, '0')
}

function databaseMessage(error: unknown) {
  return typeof error === 'object' && error && 'message' in error
    ? String((error as { message: unknown }).message)
    : undefined
}

export async function acceptInvitation(
  user: { id: string; name: string; email: string },
  token: string,
  event: H3Event,
) {
  const hash = invitationTokenHash(token)
  try {
    return await withUserTransaction(user.id, async (client) => {
      const preview = await readPreview(client, hash)
      if (!preview.valid) raise('INVITATION_NOT_FOUND', 'Ftesa nuk u pranua.')

      const businessName = preview.profile.businessName || preview.organizationName
      const state = emptyWorkspace(user.name, user.email)
      Object.assign(state.brand, {
        name: businessName,
        city: preview.profile.city || '',
        industry: preview.profile.industry || '',
      })
      const { posts: _posts, assets: _assets, ...profile } = state

      const result = await client.query<{
        accepted: { organizationId: string; role: string }
      }>('SELECT public.accept_organization_invitation($1,$2,$3) AS accepted', [
        hash,
        businessSlugFromName(businessName),
        JSON.stringify(profile),
      ])
      const accepted = result.rows[0]!.accepted

      // Onboarding grants the trial, but only on the path that creates the
      // business. An invited client already has one, so that path never runs
      // and the trial has to be granted here instead.
      await setTenantContext(client, {
        userId: user.id,
        organizationId: accepted.organizationId,
      })
      await grantTrial(client, accepted.organizationId, user.email, deviceIdentity(event))
      return accepted
    })
  } catch (error) {
    if (typeof error === 'object' && error && 'statusCode' in error) throw error
    raise(databaseMessage(error), 'Ftesa nuk u pranua.')
  }
}
