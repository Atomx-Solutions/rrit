import { monthSchema } from '../../../shared/schemas/monthly-plan'
import { monthlyAiConfigured, retryableMonthlyGenerationFailureCode } from '../../utils/monthly-ai'
import { plannerAccess } from '../../utils/monthly-planner'
import { postsCountedForLimit, videosCountedForLimit } from '../../utils/trials'
import {
  plannerEvidence,
  plannerPrerequisites,
  planningMonth,
  PlannerFailure,
  plannerMessageKey,
  resumableContentFailureCode,
} from '../../utils/monthly-planner-domain'
import { getBrandForBusiness } from '../../utils/brands'
import { loadPlannerBrain } from '../../utils/business-brain'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return withBusinessTransaction(user.id, async (client, business) => {
    const { workspace } = await loadWorkspace(client, business.id, user.id)
    const requested = getQuery(event).month
    const month = monthSchema.safeParse(requested || planningMonth(workspace.preferences.timezone))
    if (!month.success)
      throw createError({ statusCode: 422, message: 'server.MONTH_INVALID' })
    const access = await plannerAccess(
      business.id,
      month.data,
      workspace.preferences.timezone,
      client,
    )
    const settings = await client.query(
      'SELECT enabled,photo_mode,preferred_asset_ids,preferred_video_asset_ids,preferred_video_extra_asset_ids,configured_at FROM monthly_planner_settings WHERE business_id=$1',
      [business.id],
    )
    let prerequisite: string | null = null
    // Readiness must judge the same inputs generation will use, or a business
    // whose facts live only in Business Brain is told it is not ready while
    // the planner would happily run.
    const brand = await getBrandForBusiness(client, business.id, business.slug)
    const businessBrain = brand
      ? await loadPlannerBrain(client, business.id, brand.id)
      : { brain: undefined, facts: [] }
    const prerequisites = plannerPrerequisites(
      workspace,
      new Date(),
      month.data,
      businessBrain.facts,
    )
    try {
      plannerEvidence(workspace, new Date(), month.data, undefined, [], businessBrain)
    } catch (error) {
      prerequisite = error instanceof PlannerFailure ? error.code : 'BUSINESS_CONTEXT_REQUIRED'
    }
    const result = await client.query(
      `SELECT id,status,stage,target_count,generate_count,batch_start,batch_video_count,completed_count,evidence_hash,research,editorial_plan,error_code,created_at,updated_at
      FROM monthly_plans WHERE business_id=$1 AND month=$2::date`,
      [business.id, `${month.data}-01`],
    )
    const row = result.rows[0]
    // A video is rendered after its post is committed, so a plan reads as done
    // while its videos are still being made. The panel waits for these too.
    const videosRendering = row
      ? (
          await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM posts
              WHERE business_id=$1 AND monthly_plan_id=$2
                AND payload->'video'->>'status' IN ('brief_ready','rendering')`,
            [business.id, row.id],
          )
        ).rows[0]?.count || 0
      : 0
    const usedPosts = access
      ? await postsCountedForLimit(client, business.id, month.data, access.paid, access.quotaPeriod)
      : 0
    const usedVideos = access ? await videosCountedForLimit(client, business.id, access.quotaPeriod) : 0
    const worker = await client.query(
      "SELECT EXISTS(SELECT 1 FROM worker_heartbeats WHERE name='monthly_planner' AND last_seen_at>now()-interval '5 minutes') AS alive",
    )
    return {
      month: month.data,
      configured: monthlyAiConfigured(),
      enabled: settings.rows[0]?.enabled !== false,
      photoPreference: {
        configured: !!settings.rows[0]?.configured_at,
        mode: (settings.rows[0]?.photo_mode || 'auto') as 'auto' | 'selected',
        selectedAssetIds: (settings.rows[0]?.preferred_asset_ids || []) as string[],
        // The photographs held back for motion, so the planner can show which
        // of the chosen photographs belong to which deliverable.
        selectedVideoAssetIds: (settings.rows[0]?.preferred_video_asset_ids || []) as string[],
        // Further photographs of each video's subject, keyed by its main one.
        videoExtraAssetIds: (settings.rows[0]?.preferred_video_extra_asset_ids || {}) as Record<string, string[]>,
      },
      paid: access?.paid || false,
      package: access?.plan || null,
      entitled: !!access?.features.includes('ai') && access.features.includes('posts'),
      limit: access?.limits.posts_per_month || 0,
      usage: {
        included: access?.limits.posts_per_month || 0,
        used: usedPosts,
        remaining: Math.max(0, (access?.limits.posts_per_month || 0) - usedPosts),
      },
      // Videos have an allowance of their own, so the planner can state what is
      // left of it instead of letting a business ask for more than it bought.
      videoUsage: {
        included: access?.limits.videos_per_month || 0,
        used: usedVideos,
        remaining: Math.max(0, (access?.limits.videos_per_month || 0) - usedVideos),
      },
      workerAlive: worker.rows[0]?.alive === true,
      prerequisite: prerequisite
        ? plannerMessageKey(prerequisite, 'planner.prerequisiteDefault')
        : null,
      prerequisiteCode: prerequisite,
      prerequisites,
      plan: row
        ? {
            id: row.id as string,
            status: row.status as string,
            stage: row.stage as string,
            total: row.target_count as number,
            requested: row.generate_count as number,
            completed: row.completed_count as number,
            videosRendering,
            // The run the customer just started, reported on its own:
            // `generate_count` accumulates across requests and would otherwise
            // make a single new post read as part of a larger job.
            batch: {
              total: (row.generate_count as number) - (row.batch_start as number),
              completed: (row.completed_count as number) - (row.batch_start as number),
              // How many of the batch's deliverables are videos, so the panel
              // names what is waiting instead of calling every one a post.
              videos: row.batch_video_count as number,
            },
            // Posts and videos are drawn on request, so the panel needs to know
            // the plan can take another request. What is left to ask for comes
            // from the package allowances above, not from the plan's target,
            // which never counts videos that have not been asked for yet.
            extendable: row.status === 'idle' || row.status === 'review',
            errorCode: (row.error_code as string | null) || null,
            error: row.error_code
              ? plannerMessageKey(row.error_code, 'planner.needsReview')
              : null,
            restartable:
              row.status === 'blocked' &&
              !['BUDGET_ESTIMATE_EXCEEDED', 'PROVIDER_RETRY_EXHAUSTED'].includes(
                row.error_code || '',
              ) &&
              (row.completed_count === 0 ||
                (row.stage === 'content' && resumableContentFailureCode(row.error_code)) ||
                (row.stage === 'planning' && retryableMonthlyGenerationFailureCode(row.error_code))) &&
              row.error_code !== 'BUDGET_ESTIMATE_EXCEEDED',
            research: row.research as
              import('../../../shared/schemas/monthly-plan').Research | null,
            strategy: row.editorial_plan
              ? {
                  objective: row.editorial_plan.objective as string,
                  audience: row.editorial_plan.audience as string,
                  rationale: row.editorial_plan.rationale as string,
                  slots: row.editorial_plan.slots as import('../../../shared/schemas/monthly-plan').SlotBrief[],
                }
              : null,
            updatedAt: row.updated_at.toISOString() as string,
          }
        : null,
    }
  })
})
