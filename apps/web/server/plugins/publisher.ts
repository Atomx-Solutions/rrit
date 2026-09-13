import { acquireOperationsWorkerDatabase } from '../utils/database'
import { runPublishingBatch } from '../utils/publishing'

export default defineNitroPlugin((nitro) => {
  const role = process.env.PROCESS_ROLE || 'all'
  if (process.env.PUBLISHING_ENABLED !== 'true' || !['publisher', 'all'].includes(role)) return
  if (!process.env.WORKER_DATABASE_URL) {
    console.error('Publisher requires WORKER_DATABASE_URL and will not start.')
    return
  }
  const worker = acquireOperationsWorkerDatabase()
  let running = false
  let closing = false
  let current: Promise<void> | undefined
  function tick() {
    if (running || closing) return current
    running = true
    current = runPublishingBatch(worker.db)
      .then(() => undefined)
      .catch(() => {
        console.error('Publisher tick failed; inspect database connectivity and worker health.')
      })
      .finally(() => {
        running = false
        current = undefined
      })
    return current
  }
  const configuredInterval = Number(process.env.PUBLISHING_POLL_INTERVAL_MS || 5000)
  const interval =
    Number.isInteger(configuredInterval) && configuredInterval >= 1000 && configuredInterval <= 60000
      ? configuredInterval
      : 5000
  const timer = setInterval(tick, interval)
  timer.unref()
  void tick()
  nitro.hooks.hook('close', async () => {
    closing = true
    clearInterval(timer)
    await current
    await worker.release()
  })
})
