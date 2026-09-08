import { runRetentionBatch } from '../utils/retention'

export default defineNitroPlugin((nitro) => {
  const role = process.env.PROCESS_ROLE || 'all'
  if (process.env.MAINTENANCE_ENABLED === 'false' || !['maintenance', 'all'].includes(role)) return
  let running = false
  let closing = false
  let current: Promise<void> | undefined
  function tick() {
    if (running || closing) return current
    running = true
    current = runRetentionBatch()
      .then(() => undefined)
      .catch(() => {
        console.error('Retention maintenance failed; inspect database health.')
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
  })
})
