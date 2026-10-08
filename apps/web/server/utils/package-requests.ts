import { createHmac } from 'node:crypto'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { withUserTransaction } from './database'

/**
 * A request for a package. Prices are not part of it: the customer says how
 * much they need, and the team answers with an offer.
 */
export const packageRequestPlatformSchema = z.enum(['instagram', 'facebook', 'both'])
export const packageRequestSchema = z.object({
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.email().max(320),
  phone: z.string().trim().min(4).max(40),
  businessName: z.string().trim().min(2).max(120),
  industry: z.string().trim().min(2).max(100).optional(),
  platform: packageRequestPlatformSchema.optional(),
  // A predefined amount and a typed one are the same answer to the database:
  // what matters is the number the visitor settled on.
  postsRequested: z.number().int().min(1).max(1000),
  message: z.string().trim().max(2000).optional(),
})
export type PackageRequestInput = z.infer<typeof packageRequestSchema>

/**
 * From inside the app the contact is whoever is signed in, so identity is taken
 * from the session rather than accepted from the request body.
 */
export const appPackageRequestSchema = packageRequestSchema
  .pick({ message: true })
  .extend({
    // Inside the app a request may be for posts, for credits, or for both.
    // Zero means "not asking for this", and asking for neither is not a
    // request at all.
    postsRequested: z.number().int().min(0).max(1000).default(0),
    creditsRequested: z.number().int().min(0).max(10_000_000).default(0),
    videosRequested: z.number().int().min(0).max(1000).default(0),
  })
  .refine((value) => value.postsRequested > 0 || value.creditsRequested > 0 || value.videosRequested > 0, {
    message: 'server.REQUEST_POSTS_OR_CREDITS',
    path: ['postsRequested'],
  })

/**
 * The amounts offered as a starting point on the form. They are a setting
 * rather than a catalogue: every organization agrees its own volume, so these
 * only save the visitor from typing the usual ones.
 */
export async function packageRequestPostOptions() {
  const result = await withUserTransaction('', client =>
    client.query<{ package_request_post_options: number[] }>(
      'SELECT package_request_post_options() AS package_request_post_options',
    ),
  )
  return result.rows[0]?.package_request_post_options ?? []
}

/**
 * What a post costs today.
 *
 * The public page quotes this before anyone fills in a form, so it is read
 * from the same setting the team edits rather than written into the page. An
 * agreed package still carries the rate it was written with.
 */
export async function packageRequestPostPrice() {
  const result = await withUserTransaction('', client =>
    client.query<{ package_request_post_price_cents: number }>(
      'SELECT package_request_post_price_cents() AS package_request_post_price_cents',
    ),
  )
  return Number(result.rows[0]?.package_request_post_price_cents ?? 0)
}

export async function packageRequestVideoPrice() {
  const result = await withUserTransaction('', client => client.query<{ package_request_video_price_cents: number }>('SELECT package_request_video_price_cents() AS package_request_video_price_cents'))
  return Number(result.rows[0]?.package_request_video_price_cents ?? 200)
}

/**
 * A keyed hash of the caller's address, so the rate limit can recognise a
 * repeat submitter without the address ever being stored. Requests are still
 * accepted when no key is configured; the limit is a courtesy, not a gate that
 * should take the form offline.
 */
export function submitterHash(event: H3Event) {
  const key = process.env.TRIAL_HASH_KEY
  if (!key || key.length < 32) return null
  const forwarded = getRequestHeader(event, 'x-forwarded-for') || ''
  const address = forwarded.split(',')[0]?.trim() || getRequestIP(event, { xForwardedFor: true })
  if (!address) return null
  return createHmac('sha256', key).update(`package-request:${address}`).digest('hex')
}

const failures: Record<string, { statusCode: number; message: string }> = {
  REQUEST_RATE_LIMITED: {
    statusCode: 429,
    message: 'server.RATE_LIMIT_REACHED',
  },
  REQUEST_INVALID: { statusCode: 400, message: 'server.REQUEST_INVALID' },
}

export function packageRequestFailure(message: string | undefined) {
  const match = message ? Object.keys(failures).find((code) => message.includes(code)) : undefined
  return match ? { ...failures[match]!, code: match } : null
}

/**
 * Stores the request. The caller holds no privilege on the table: the database
 * function is the only way in, and it enforces the rate limit itself so the
 * limit survives a restart and applies across every running instance.
 */
export async function submitPackageRequest(input: {
  values: PackageRequestInput | (z.infer<typeof appPackageRequestSchema> & Partial<PackageRequestInput>)
  source: 'landing' | 'app'
  organizationId: string | null
  submitterHash: string | null
  userId: string | null
}) {
  const { values } = input
  try {
    return await withUserTransaction(input.userId ?? '', async (client) => {
      const result = await client.query<{ submit_package_request: string }>(
        'SELECT submit_package_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [
          values.contactName,
          values.contactEmail,
          values.postsRequested,
          input.source,
          input.organizationId,
          values.phone ?? null,
          values.message ?? null,
          input.submitterHash,
          values.businessName ?? null,
          values.industry ?? null,
          values.platform ?? null,
          'creditsRequested' in values ? values.creditsRequested : 0,
          'videosRequested' in values ? values.videosRequested : 0,
        ],
      )
      return { id: result.rows[0]!.submit_package_request }
    })
  } catch (error) {
    const failure = packageRequestFailure(
      error instanceof Error ? error.message : String(error ?? ''),
    )
    if (failure)
      throw createError({
        statusCode: failure.statusCode,
        message: failure.message,
        data: { code: failure.code },
      })
    throw error
  }
}
