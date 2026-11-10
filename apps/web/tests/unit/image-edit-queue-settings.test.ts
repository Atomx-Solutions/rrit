import { describe, expect, it, vi } from 'vitest'
import { imageEditQueueSettings } from '../../server/utils/monthly-planner-domain'

vi.mock('../../server/utils/monthly-planner', () => ({ monthlyWorkerDatabase: vi.fn() }))
const { claimImageEdit } = await import('../../server/utils/image-edit-queue')

describe('photo edit queue settings', () => {
  it('reads the paid and trial pools from the environment', () => {
    expect(imageEditQueueSettings({
      IMAGE_EDIT_CONCURRENCY: '7',
      IMAGE_EDIT_CONCURRENCY_PER_BUSINESS: '2',
      IMAGE_EDIT_TRIAL_CONCURRENCY: '4',
      IMAGE_EDIT_TRIAL_CONCURRENCY_PER_BUSINESS: '1',
      IMAGE_EDIT_MIN_SECONDS: '120',
      IMAGE_EDIT_QUEUE_POLL_SECONDS: '4',
    })).toEqual({ concurrency: 7, perBusiness: 2, trialConcurrency: 4, trialPerBusiness: 1, minEditMs: 120000, pollMs: 4000 })
  })

  it('keeps the default when a value is not a positive whole number', () => {
    const defaults = imageEditQueueSettings({})
    expect(imageEditQueueSettings({ IMAGE_EDIT_TRIAL_CONCURRENCY: '0', IMAGE_EDIT_CONCURRENCY_PER_BUSINESS: 'many' }))
      .toMatchObject({ trialConcurrency: defaults.trialConcurrency, perBusiness: defaults.perBusiness })
  })
})

function fakeDb(active: { paid: number; trial: number }) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes('FILTER')) return { rows: [active] }
    if (sql.startsWith('UPDATE image_edits')) return { rows: [] }
    return { rows: [] }
  })
  return { db: { connect: async () => ({ query, release: vi.fn() }) } as never, query }
}
const pools = { concurrency: 40, perBusiness: 3, trialConcurrency: 10, trialPerBusiness: 1 }

describe('claiming a photo edit', () => {
  it('lets only paid edits start while the trial pool is full', async () => {
    const { db, query } = fakeDb({ paid: 5, trial: 10 })
    await claimImageEdit(db, 'owner', new Date(), pools)
    const claim = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE image_edits'))!
    expect(claim[1]).toEqual(['owner', expect.any(Date), true, 3, false, 1])
  })

  it('lets only trial edits start while the paid pool is full', async () => {
    const { db, query } = fakeDb({ paid: 40, trial: 2 })
    await claimImageEdit(db, 'owner', new Date(), pools)
    const claim = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE image_edits'))!
    expect(claim[1]).toEqual(['owner', expect.any(Date), false, 3, true, 1])
  })

  it('claims nothing when both pools are full', async () => {
    const { db, query } = fakeDb({ paid: 40, trial: 10 })
    await expect(claimImageEdit(db, 'owner', new Date(), pools)).resolves.toBeUndefined()
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE image_edits'))).toBe(false)
  })
})
