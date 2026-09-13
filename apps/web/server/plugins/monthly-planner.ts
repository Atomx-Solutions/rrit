import { monthlyAiConfigured } from '../utils/monthly-ai'
import { closeMonthlyWorkerDatabase, runMonthlyPlannerTick } from '../utils/monthly-planner'

export default defineNitroPlugin((nitro) => {
  if (!monthlyAiConfigured() || !['planner', 'all'].includes(process.env.PROCESS_ROLE || 'all'))
    return
  if (!process.env.WORKER_DATABASE_URL) {
    console.error('Monthly planner requires WORKER_DATABASE_URL.')
    return
  }
  let closing = false
  let current: Promise<void> | undefined
  function tick() {
    if (closing || current) return
    current = runMonthlyPlannerTick()
      .catch((error: unknown) => {
        const name = error instanceof Error ? error.name : 'UnknownError'
        const rawCode =
          typeof error === 'object' && error && 'code' in error ? String(error.code) : undefined
        const code = rawCode && /^[A-Z0-9_]{1,64}$/i.test(rawCode) ? rawCode : undefined
        const rawStage =
          typeof error === 'object' && error && 'plannerStage' in error
            ? String(error.plannerStage)
            : undefined
        const stage = rawStage && /^[a-z0-9_.-]{1,64}$/i.test(rawStage) ? rawStage : undefined
        const database =
          typeof error === 'object' && error
            ? Object.fromEntries(
                ['schema', 'table', 'column', 'constraint', 'routine'].flatMap((field) => {
                  if (!(field in error)) return []
                  const rawValue = error[field as keyof typeof error]
                  if (typeof rawValue !== 'string') return []
                  const value = rawValue
                  return /^[a-z0-9_.-]{1,128}$/i.test(value) ? [[field, value]] : []
                }),
              )
            : undefined
        const issues =
          typeof error === 'object' &&
          error &&
          'issues' in error &&
          Array.isArray(error.issues)
            ? error.issues.slice(0, 8).map((issue: unknown) => {
                if (typeof issue !== 'object' || !issue) return 'unknown'
                const path =
                  'path' in issue && Array.isArray(issue.path)
                    ? issue.path.map(String).join('.') || 'root'
                    : 'root'
                const issueCode = 'code' in issue ? String(issue.code) : 'invalid'
                return `${path}:${issueCode}`.slice(0, 160)
              })
            : undefined
        console.error(
          'Monthly planner stopped this tick; inspect worker configuration and database health.',
          { name, code, stage, database, issues },
        )
      })
      .finally(() => {
        current = undefined
      })
  }
  const timer = setInterval(tick, 15000)
  timer.unref()
  tick()
  nitro.hooks.hook('close', async () => {
    closing = true
    clearInterval(timer)
    await current
    await closeMonthlyWorkerDatabase()
  })
})
