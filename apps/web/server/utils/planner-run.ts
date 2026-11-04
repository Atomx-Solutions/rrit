import type { H3Event } from 'h3'
import { getDeadline, waitUntil } from '@vercel/functions'
import { runMonthlyPlannerBatch } from './monthly-planner'

/**
 * When Vercel stops this invocation: the platform's own deadline when it
 * reports one, otherwise the configured function limit counted from `started`.
 */
export function invocationDeadline(event: H3Event, started: number) {
  return (
    getDeadline()?.getTime()
    ?? started + useRuntimeConfig(event).functionMaxDurationSeconds * 1000
  )
}

/**
 * Starts the planner as soon as a business asks for work, rather than leaving
 * it to the next minute's cron. On Vercel the run carries on after the reply
 * until the function's limit; elsewhere the planner's own timer picks it up
 * within seconds anyway. A plan another run already holds is left to it.
 */
export function startMonthlyPlannerNow(event: H3Event, started: number) {
  if (!process.env.VERCEL) return
  waitUntil(
    runMonthlyPlannerBatch(undefined, { deadline: invocationDeadline(event, started), discover: false })
      .catch((error: unknown) =>
        console.error('The planner could not start right after the request', {
          error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
        })),
  )
}
