import { timingSafeEqual } from 'node:crypto'
import { invocationDeadline, runPlannerAndVideos } from '../../utils/planner-run'

// Vercel Cron calls this every minute with the project's CRON_SECRET. Each
// call advances plans and renders queued videos until shortly before the
// function's time limit, so the calls overlap and their work runs side by side.
export default defineEventHandler(async (event) => {
  const started = Date.now()
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('The planner cron was called but CRON_SECRET is not set.')
    throw createError({ statusCode: 401, message: 'server.ACCESS_DENIED' })
  }
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(getHeader(event, 'authorization') || '')
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    throw createError({ statusCode: 401, message: 'server.ACCESS_DENIED' })
  await runPlannerAndVideos({ deadline: invocationDeadline(event, started) })
  return { ok: true }
})
