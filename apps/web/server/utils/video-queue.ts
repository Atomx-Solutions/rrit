import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { aiVideoConfigured } from './ai-video-provider'
import { monthlyWorkerDatabase } from './monthly-planner'
import { plannerRunSettings, runClaimedJobs, videoQueueSettings } from './monthly-planner-domain'
import { failStoppedRender, renderQueuedVideo, type ClaimedVideoRender } from './video-render'

function warnQueue(message: string, error: unknown) {
  console.warn(message, {
    error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
  })
}

/**
 * Takes the oldest queued render for this run, unless as many renders as
 * VIDEO_CONCURRENCY already hold a live lease. A business that already has
 * `perBusiness` renders under way is passed over for the next business in
 * line, so its later videos wait their turn without holding up anyone else's.
 * Claims are taken one at a time, so two runs can never both read room for
 * one more render and both take it.
 */
export async function claimVideoRender(
  db: Pool,
  leaseOwner: string,
  leaseUntil: Date,
  concurrency: number,
  perBusiness = videoQueueSettings().perBusiness,
) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('video_renders.claim'))")
    const active = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM video_renders WHERE status='rendering' AND lease_until>now()",
    )
    if ((active.rows[0]?.count || 0) >= concurrency) {
      await client.query('COMMIT')
      return undefined
    }
    const claimed = await client.query<{ id: string; post_id: string; requested_by: string; business_id: string }>(
      `UPDATE video_renders SET status='rendering',lease_owner=$1,lease_until=$2
        WHERE id=(
          SELECT queued.id FROM video_renders AS queued
           WHERE queued.status='queued' AND queued.requested_by IS NOT NULL
             AND (
               SELECT count(*) FROM video_renders AS active
                WHERE active.business_id=queued.business_id
                  AND active.status='rendering' AND active.lease_until>now()
             ) < $3
           ORDER BY queued.created_at,queued.id LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING id,post_id,requested_by,business_id`,
      [leaseOwner, leaseUntil, perBusiness],
    )
    const row = claimed.rows[0]
    if (row) {
      // What the business still has waiting behind this one, so the logs show
      // its videos being made in turn.
      const waiting = await client.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM video_renders WHERE business_id=$1 AND status='queued'",
        [row.business_id],
      )
      console.info('A video starts rendering.', {
        renderId: row.id,
        postId: row.post_id,
        businessId: row.business_id,
        renderingAtOnce: (active.rows[0]?.count || 0) + 1,
        perBusiness,
        waitingForBusiness: waiting.rows[0]?.count || 0,
      })
    }
    await client.query('COMMIT')
    return row ? { id: row.id, postId: row.post_id, requestedBy: row.requested_by, leaseOwner } : undefined
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

// Renders whose lease expired belong to runs that were stopped mid-render. A
// render started before the queue has no lease; it ran inside one function,
// so once that function's limit and the lease margin have passed it is gone
// too, and is settled the same way instead of reading as in progress forever.
async function settleStoppedRenders(db: Pool, staleAfterSeconds: number) {
  const stopped = await db.query<{ id: string; post_id: string; actor_id: string }>(
    `SELECT r.id,r.post_id,COALESCE(r.requested_by,b.owner_id) AS actor_id
      FROM video_renders r JOIN businesses b ON b.id=r.business_id
      WHERE r.status='rendering'
        AND COALESCE(r.lease_until, r.created_at + make_interval(secs => $1)) < now()
      ORDER BY r.created_at LIMIT 20`,
    [staleAfterSeconds],
  )
  for (const render of stopped.rows) {
    try {
      await failStoppedRender({ id: render.id, postId: render.post_id, actorId: render.actor_id, staleAfterSeconds })
      console.warn('A video render was stopped before it finished; its credits were released', { renderId: render.id })
    } catch (error) {
      warnQueue('A stopped video render could not be settled yet', error)
    }
  }
}

/**
 * Renders queued videos until `deadline` (epoch ms), when the host stops the
 * function. Up to VIDEO_CONCURRENCY videos render at once, and one is started
 * only while VIDEO_MIN_RENDER_SECONDS of the run are still left. While
 * `waitWhile` holds (the same run is still planning), an idle lane keeps
 * looking for videos those plans queue, so they start without waiting for the
 * next run.
 *
 * Leases follow the planner's: with a deadline they end a margin after it;
 * without one they last PLANNER_LEASE_SECONDS and are renewed while rendering.
 */
export async function runVideoRenderQueue(
  db: Pool = monthlyWorkerDatabase(),
  options: { deadline?: number; waitWhile?: () => boolean } = {},
) {
  if (!aiVideoConfigured()) return
  const lease = plannerRunSettings()
  const settings = videoQueueSettings()
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY
  const bounded = Number.isFinite(deadline)
  const leaseUntil = () =>
    new Date(bounded ? deadline + lease.leaseMarginMs : Date.now() + lease.leaseMs)
  const leaseOwner = randomUUID()
  const renewal = bounded
    ? undefined
    : setInterval(() => {
        void db
          .query("UPDATE video_renders SET lease_until=$2 WHERE lease_owner=$1 AND status='rendering'", [leaseOwner, leaseUntil()])
          .catch((error: unknown) => warnQueue('Video render lease renewal was interrupted.', error))
      }, 30000)
  renewal?.unref()
  try {
    await settleStoppedRenders(
      db,
      useRuntimeConfig().functionMaxDurationSeconds + lease.leaseMarginMs / 1000,
    )
    await runClaimedJobs<ClaimedVideoRender>({
      concurrency: settings.concurrency,
      deadline,
      minStepMs: settings.minRenderMs,
      idleMs: settings.pollMs,
      waitWhile: options.waitWhile,
      claim: () => claimVideoRender(db, leaseOwner, leaseUntil(), settings.concurrency, settings.perBusiness),
      // The render records its own failure on the post and gives the credits
      // back, so the run only notes it and moves on.
      run: async (job) => {
        await renderQueuedVideo(job)
      },
      onError: (error) => warnQueue('A queued video could not be claimed or rendered', error),
    })
  } finally {
    if (renewal) clearInterval(renewal)
  }
}
