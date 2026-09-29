import { createHmac } from 'node:crypto'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { withUserTransaction } from './database'

/**
 * A request for a package. Prices are not part of it: the customer says how
 * much they need, and the team answers with an offer.
 */
export const packageRequestSchema = z.object({
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.email().max(320),
  phone: z.string().trim().min(4).max(40).optional(),
  postsRequested: z.number().int().min(1).max(1000),
  message: z.string().trim().max(2000).optional(),
})
export type PackageRequestInput = z.infer<typeof packageRequestSchema>

/**
 * From inside the app the contact is whoever is signed in, so identity is taken
 * from the session rather than accepted from the request body.
 */
export const appPackageRequestSchema = packageRequestSchema.pick({
  postsRequested: true,
  message: true,
})

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
    message: 'Ke dërguar disa kërkesa së fundmi. Provo sërish më vonë ose na shkruaj me email.',
  },
  REQUEST_INVALID: { statusCode: 400, message: 'Kërkesa nuk është e vlefshme.' },
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
  values: PackageRequestInput
  source: 'landing' | 'app'
  organizationId: string | null
  submitterHash: string | null
  userId: string | null
}) {
  const { values } = input
  try {
    return await withUserTransaction(input.userId ?? '', async (client) => {
      const result = await client.query<{ submit_package_request: string }>(
        'SELECT submit_package_request($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          values.contactName,
          values.contactEmail,
          values.postsRequested,
          input.source,
          input.organizationId,
          values.phone ?? null,
          values.message ?? null,
          input.submitterHash,
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
