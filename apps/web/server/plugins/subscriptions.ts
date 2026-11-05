import { acquireOperationsWorkerDatabase } from '../utils/database'
import { onVercel } from '../utils/host'
import { runPackageExpiry } from '../utils/custom-packages'

// Dynamic package expiry is database-owned and must be maintained even though
// the legacy static subscription service is no longer part of the runtime.
export default defineNitroPlugin((nitro) => {
  const role = process.env.PROCESS_ROLE || 'all'
  if (process.env.MAINTENANCE_ENABLED === 'false' || !['maintenance', 'all'].includes(role)) return
  // Every new Vercel instance would start a round of its own, and its timer
  // stops while the instance sleeps. The package cron (/api/cron/packages)
  // runs it there instead.
  if (onVercel()) return
  if (!process.env.WORKER_DATABASE_URL) {
    console.error('Package maintenance requires WORKER_DATABASE_URL and will not start.')
    return
  }
  const worker = acquireOperationsWorkerDatabase()
  let running = false
  let closing = false
  let current: Promise<void> | undefined
  function tick() {
    if (running || closing) return current
    running = true
    current = runPackageExpiry(worker.db)
      .then(() => undefined)
      .catch(() => {
        console.error('Dynamic package maintenance failed; inspect database health.')
      })
      .finally(() => {
        running = false
        current = undefined
      })
    return current
  }
  const timer = setInterval(tick, 15 * 60 * 1000)
  timer.unref()
  void tick()
  nitro.hooks.hook('close', async () => {
    closing = true
    clearInterval(timer)
    await current
    await worker.release()
  })
})
