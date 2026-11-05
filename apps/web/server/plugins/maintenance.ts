import { acquireOperationsWorkerDatabase } from '../utils/database'
import { onVercel } from '../utils/host'
import { runRetentionBatch } from '../utils/retention'

export default defineNitroPlugin((nitro) => {
  const role = process.env.PROCESS_ROLE || 'all'
  if (process.env.MAINTENANCE_ENABLED === 'false' || !['maintenance', 'all'].includes(role)) return
  // Every new Vercel instance would start a clean-up of its own, and one frozen
  // half-way held the retention lock for all of them. The daily maintenance
  // cron (/api/cron/maintenance) runs it there instead.
  if (onVercel()) return
  if (!process.env.WORKER_DATABASE_URL) {
    console.error('Maintenance requires WORKER_DATABASE_URL and will not start.')
    return
  }
  const worker = acquireOperationsWorkerDatabase()
  let running = false
  let closing = false
  let current: Promise<void> | undefined
  function tick() {
    if (running || closing) return current
    running = true
    current = runRetentionBatch(worker.db)
      .then(() => undefined)
      .catch((error) => {
        console.error('Retention maintenance failed; inspect database health.', {
          message: error instanceof Error ? error.message : String(error),
          code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
        })
      })
      .finally(() => {
        running = false
        current = undefined
      })
    return current
  }
  const timer = setInterval(tick, 6 * 60 * 60 * 1000)
  timer.unref()
  void tick()
  nitro.hooks.hook('close', async () => {
    closing = true
    clearInterval(timer)
    await current
    await worker.release()
  })
})
