import { requireCronSecret } from '../../utils/cron-auth'
import { acquireOperationsWorkerDatabase } from '../../utils/database'
import { runRetentionBatch } from '../../utils/retention'

// Vercel Cron calls this once a day: the retention clean-up a long-running
// host runs from its maintenance timer.
export default defineEventHandler(async (event) => {
  requireCronSecret(event)
  if (process.env.MAINTENANCE_ENABLED === 'false') return { ok: true, skipped: true }
  const worker = acquireOperationsWorkerDatabase()
  try {
    return { ok: true, result: await runRetentionBatch(worker.db) }
  } finally {
    await worker.release()
  }
})
