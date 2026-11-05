import { requireCronSecret } from '../../utils/cron-auth'
import { runPackageExpiry } from '../../utils/custom-packages'
import { acquireOperationsWorkerDatabase } from '../../utils/database'

// Vercel Cron calls this every quarter of an hour: the package expiry a
// long-running host runs from its package timer.
export default defineEventHandler(async (event) => {
  requireCronSecret(event)
  if (process.env.MAINTENANCE_ENABLED === 'false') return { ok: true, skipped: true }
  const worker = acquireOperationsWorkerDatabase()
  try {
    return { ok: true, result: await runPackageExpiry(worker.db) }
  } finally {
    await worker.release()
  }
})
