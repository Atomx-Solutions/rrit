import { requireCronSecret } from '../../utils/cron-auth'
import { invocationDeadline, runPlannerAndVideos } from '../../utils/planner-run'

// Vercel Cron calls this every minute with the project's CRON_SECRET. Each
// call advances plans and renders queued videos until shortly before the
// function's time limit, so the calls overlap and their work runs side by side.
export default defineEventHandler(async (event) => {
  const started = Date.now()
  requireCronSecret(event)
  await runPlannerAndVideos({ deadline: invocationDeadline(event, started) })
  return { ok: true }
})
