import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { database } from './database'

export type DeauthorizationProvider = 'facebook' | 'instagram'

// Meta signs the request with the secret of the app the person authorized:
// the Facebook app for Facebook Login, the Instagram app for Instagram Login.
function providerSecret(provider: DeauthorizationProvider) {
  return provider === 'facebook' ? process.env.META_APP_SECRET : process.env.INSTAGRAM_APP_SECRET
}

/** Verifies a Meta signed_request and returns the person's id, or null. */
export function verifySignedRequest(value: string, secret: string) {
  const [signature, payload] = value.split('.')
  if (!signature || !payload) return null
  const expected = createHmac('sha256', secret).update(payload).digest()
  const received = Buffer.from(signature, 'base64url')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      algorithm?: string
      user_id?: string | number
    }
    if (data.algorithm?.toUpperCase() !== 'HMAC-SHA256' || !data.user_id) return null
    return String(data.user_id)
  } catch {
    return null
  }
}

async function signedAccount(event: H3Event, provider: DeauthorizationProvider) {
  const secret = providerSecret(provider)
  if (!secret) throw createError({ statusCode: 503, message: 'server.META_NOT_CONFIGURED' })
  const raw = (await readRawBody(event)) || ''
  if (raw.length > 8192) throw createError({ statusCode: 413 })
  const accountId = verifySignedRequest(new URLSearchParams(raw).get('signed_request') || '', secret)
  if (!accountId) throw createError({ statusCode: 400, message: 'server.REQUEST_DENIED' })
  return accountId
}

async function asRuntime<T>(work: (client: import('pg').PoolClient) => Promise<T>) {
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE app_runtime')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** The person removed Framic from their account: stop using the connection. */
export async function deauthorizeProviderAccount(event: H3Event, provider: DeauthorizationProvider) {
  const accountId = await signedAccount(event, provider)
  await asRuntime((client) =>
    client.query('SELECT app.remove_provider_account($1,$2,false)', [provider, accountId]),
  )
  return { success: true }
}

/** The person asked for their data to be deleted: remove it and confirm. */
export async function deleteProviderAccountData(event: H3Event, provider: DeauthorizationProvider) {
  const accountId = await signedAccount(event, provider)
  const confirmationCode = randomBytes(16).toString('hex')
  await asRuntime(async (client) => {
    const removed = await client.query<{ removed: number }>(
      'SELECT app.remove_provider_account($1,$2,true) AS removed',
      [provider, accountId],
    )
    await client.query('SELECT app.record_provider_data_deletion($1,$2,$3)', [
      confirmationCode,
      provider,
      removed.rows[0]?.removed || 0,
    ])
  })
  const url = new URL('/api/data-deletion/status', process.env.APP_URL)
  url.searchParams.set('code', confirmationCode)
  return { url: url.toString(), confirmation_code: confirmationCode }
}

export async function providerDataDeletionStatus(code: string) {
  const result = await asRuntime((client) =>
    client.query<{ provider: string; completed_at: Date }>(
      'SELECT provider,completed_at FROM app.provider_data_deletion_status($1)',
      [code],
    ),
  )
  return result.rows[0] || null
}
