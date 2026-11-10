import { beforeEach, describe, expect, it, vi } from 'vitest'

const credits = {
  reserveCredits: vi.fn(),
  consumeReservedCredits: vi.fn(),
  releaseReservedCredits: vi.fn(),
  creditsForCost: vi.fn(async (_client: unknown, cost: number) => cost),
}
vi.mock('../../server/utils/credits', () => credits)
vi.mock('../../server/utils/ai-costs', () => ({
  aiCostConfigured: () => true,
  aiCostConfiguration: () => ({ dailyBudgetMicroEur: 1_000_000 }),
  calculateAiCost: (input: number, output: number) => input + output,
}))
vi.mock('../../server/utils/ai-credits', () => ({ aiCreditCycleStartSql: 'now()' }))
vi.mock('../../server/utils/ai-provider', () => ({
  aiProviderConfiguration: () => ({ keyFingerprint: 'key' }),
  aiProviderModel: () => 'model',
  providerCostMicroEur: () => null,
}))

const query = vi.fn(async (sql: string, _values?: unknown[]) => {
  if (sql.startsWith('SELECT business_id')) return { rows: [] }
  if (sql.startsWith('INSERT INTO ai_daily_usage')) return { rows: [{ requests: 1 }] }
  if (sql.includes('AS total')) return { rows: [{ total: 0 }] }
  if (sql.startsWith("UPDATE ai_cost_ledger SET status='released'")) return { rows: [{ id: 1 }], rowCount: 1 }
  return { rows: [], rowCount: 0 }
})
vi.stubGlobal('database', () => ({ connect: async () => ({ query, release: vi.fn() }) }))
vi.stubGlobal('setTenantContext', vi.fn())
vi.stubGlobal('requireEntitlement', vi.fn())
vi.stubGlobal('trialStatus', vi.fn(async () => ({ limits: { ai_requests_per_day: 50 } })))
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
  Object.assign(new Error(input.message), input))

const { chargedTextAi } = await import('../../server/utils/charged-text-ai')
const args = {
  requestId: '00000000-0000-4000-8000-000000000001',
  input: { text: 'kafe' },
  kind: 'brief',
  reservedInputTokens: 100,
  reservedOutputTokens: 50,
}

describe('charging a short text request to the business', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reserves credits before the model runs and charges the real use after', async () => {
    const run = vi.fn(async () => {
      expect(credits.reserveCredits).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ credits: 150 }))
      return { output: { text: 'better' }, usage: { inputTokens: 40, outputTokens: 20 } }
    })
    await expect(chargedTextAi('user', 'business', { ...args, run })).resolves.toEqual({ text: 'better' })
    expect(credits.consumeReservedCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credits: 60, reservedCredits: 150 }),
    )
    // What was reserved but not used goes back.
    expect(credits.releaseReservedCredits).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ credits: 90 }))
  })

  it('gives every reserved credit back when the model fails', async () => {
    const run = vi.fn(async () => { throw new Error('provider down') })
    await expect(chargedTextAi('user', 'business', { ...args, run })).rejects.toMatchObject({
      statusCode: 502,
      message: 'server.AI_RESPONSE_INCOMPLETE',
    })
    expect(credits.consumeReservedCredits).not.toHaveBeenCalled()
    expect(credits.releaseReservedCredits).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ credits: 150 }))
  })

  it('stops before the model when the daily AI limit is reached', async () => {
    query.mockImplementationOnce(async () => ({ rows: [] })) // BEGIN
    const run = vi.fn()
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT INTO ai_daily_usage')) return { rows: [] }
      if (sql.startsWith('SELECT business_id')) return { rows: [] }
      return { rows: [], rowCount: 0 }
    })
    await expect(chargedTextAi('user', 'business', { ...args, run })).rejects.toMatchObject({ statusCode: 429 })
    expect(run).not.toHaveBeenCalled()
    expect(credits.reserveCredits).not.toHaveBeenCalled()
  })
})
