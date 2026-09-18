import pg from 'pg'

const organizationId = process.argv[2]
if (!organizationId) throw new Error('Pass the test organization UUID as the first argument.')

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not configured.')

// The production utility creates H3 errors. This verification script runs
// outside Nuxt and preserves the same status/data contract for assertions.
Object.assign(globalThis, {
  createError: (input: { statusCode: number; message: string; data?: unknown }) =>
    Object.assign(new Error(input.message), input),
})

const { reserveCredits, releaseReservedCredits, creditWalletSnapshot } = await import('../server/utils/credits.ts')
const pool = new pg.Pool({ connectionString })
const referenceId = `concurrency-check-${crypto.randomUUID()}`
const credits = 1125
let firstCommitted = false
let cleanupError: unknown

try {
  const before = await pool.connect()
  try {
    const snapshot = await creditWalletSnapshot(before, organizationId)
    if (snapshot.generation.spendable !== credits)
      throw new Error(`Expected ${credits} available generation credits, found ${snapshot.generation.spendable}.`)
  } finally {
    before.release()
  }

  const first = await pool.connect()
  const second = await pool.connect()
  try {
    await first.query('BEGIN')
    await reserveCredits(first, {
      organizationId,
      credits,
      usageKind: 'generation',
      referenceType: 'credit_wallet_verification',
      referenceId,
      idempotencyKey: `${referenceId}:first`,
    })

    const secondAttempt = (async () => {
      await second.query('BEGIN')
      try {
        await reserveCredits(second, {
          organizationId,
          credits,
          usageKind: 'generation',
          referenceType: 'credit_wallet_verification',
          referenceId,
          idempotencyKey: `${referenceId}:second`,
        })
        await second.query('COMMIT')
        return { accepted: true }
      } catch (error) {
        await second.query('ROLLBACK')
        return { accepted: false, error }
      }
    })()

    await new Promise(resolve => setTimeout(resolve, 100))
    await first.query('COMMIT')
    firstCommitted = true
    const result = await secondAttempt
    if (result.accepted || (result.error as { statusCode?: number } | undefined)?.statusCode !== 402)
      throw new Error('The second concurrent reservation was not rejected with 402.')
    console.log('PASS: exactly one concurrent generation reservation was accepted.')
  } finally {
    await first.query('ROLLBACK').catch(() => undefined)
    first.release()
    second.release()
  }
} finally {
  if (firstCommitted) {
    const cleanup = await pool.connect()
    try {
      await cleanup.query('BEGIN')
      await releaseReservedCredits(cleanup, {
        organizationId,
        credits,
        usageKind: 'generation',
        referenceType: 'credit_wallet_verification',
        referenceId,
        idempotencyKey: `${referenceId}:cleanup`,
      })
      await cleanup.query('COMMIT')
    } catch (error) {
      await cleanup.query('ROLLBACK').catch(() => undefined)
      cleanupError = error
    } finally {
      cleanup.release()
    }
  }
  await pool.end()
}

if (cleanupError) throw cleanupError
