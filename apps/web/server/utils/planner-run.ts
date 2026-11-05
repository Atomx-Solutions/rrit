import type { H3Event } from 'h3'
import { getDeadline, waitUntil } from '@vercel/functions'
import { runMonthlyPlannerBatch } from './monthly-planner'
import { runVideoRenderQueue } from './video-queue'
import { onVercel } from './host'

/**
 * When Vercel stops this invocation: the platform's own deadline when it
 * reports one, otherwise the configured function limit counted from `started`.
 */
export function invocationDeadline(event: H3Event, started: number) {
  const reported = getDeadline()?.getTime()
  const deadline = reported ?? started + useRuntimeConfig(event).functionMaxDurationSeconds * 1000
  // Where the limit came from and how much of it is left, so a run that stops
  // early can be traced to its deadline.
  console.info('A run starts with this much time.', {
    path: event.path,
    deadlineFrom: reported === undefined ? 'config' : 'platform',
    secondsLeft: Math.round((deadline - Date.now()) / 1000),
  })
  return deadline
}

/**
 * Advances plans and renders queued videos side by side until `deadline`.
 * While plans are still advancing, the video lanes keep looking for videos
 * those plans queue, so a planned video starts as soon as its post exists.
 */
export async function runPlannerAndVideos(options: { deadline: number; discover?: boolean }) {
  let planning = true
  // Both are awaited to the end even when one fails, so the function is never
  // stopped while the other is still working.
  const [plans, videos] = await Promise.allSettled([
    runMonthlyPlannerBatch(undefined, options).finally(() => {
      planning = false
    }),
    runVideoRenderQueue(undefined, { deadline: options.deadline, waitWhile: () => planning }),
  ])
  const failed = [plans, videos].find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
}

function keepRunningAfterReply(work: Promise<void>, what: string) {
  waitUntil(
    work.catch((error: unknown) =>
      console.error(`The ${what} could not start right after the request`, {
        error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
      })),
  )
}

/**
 * Starts the planner as soon as a business asks for work, rather than leaving
 * it to the next minute's cron. On Vercel the run carries on after the reply
 * until the function's limit; elsewhere the planner's own timer picks it up
 * within seconds anyway. A plan another run already holds is left to it.
 */
export function startMonthlyPlannerNow(event: H3Event, started: number) {
  if (!onVercel()) return
  keepRunningAfterReply(
    runPlannerAndVideos({ deadline: invocationDeadline(event, started), discover: false }),
    'planner',
  )
}

/** Starts rendering a video the business has just queued, the same way. */
export function startVideoRenderNow(event: H3Event, started: number) {
  if (!onVercel()) return
  keepRunningAfterReply(
    runVideoRenderQueue(undefined, { deadline: invocationDeadline(event, started) }),
    'video queue',
  )
}
