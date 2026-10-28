import { z } from 'zod'
import { monthSchema } from '../../../shared/schemas/monthly-plan'
import { maxVideoPhotos } from '../../../shared/schemas/storyboard'
import {
  ensureMonthlyPlan,
  requestMonthlyPosts,
  resetMonthlyPlan,
  restartMonthlyPlan,
} from '../../utils/monthly-planner'
import {
  PlannerFailure,
  plannerChannelCountsSchema,
  plannerMessages,
} from '../../utils/monthly-planner-domain'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const input = z
    .object({
      action: z.enum(['prepare', 'generate', 'restart', 'reset', 'pause', 'enable']),
      month: monthSchema.optional(),
      photoMode: z.enum(['auto', 'selected']).optional(),
      selectedAssetIds: z.array(z.uuid()).max(100).optional(),
      selectedVideoAssetIds: z.array(z.uuid()).max(100).optional(),
      // Further photographs of the subject of a video, keyed by that video's
      // main photograph (one of selectedVideoAssetIds).
      videoExtraAssetIds: z.record(z.uuid(), z.array(z.uuid()).max(maxVideoPhotos - 1)).optional(),
      // Zero images is a valid request as long as at least one video is also
      // asked for; the combined-minimum rule is enforced below after the body
      // parses, so an explicit 0 keeps round-tripping without being coerced
      // into a default of 1 somewhere down the line.
      quantity: z.number().int().min(0).max(100).optional(),
      videoQuantity: z.number().int().min(0).max(100).optional(),
      // Every publishing channel, so a platform the planner offers is never
      // silently dropped from the split the business asked for.
      channelCounts: plannerChannelCountsSchema.optional(),
      videoChannelCounts: plannerChannelCountsSchema.optional(),
    })
    .safeParse(await boundedBody(event, 16384))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'server.REQUEST_INVALID' })
  try {
    const result = await withBusinessTransaction(user.id, async (client, business) => {
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
      if (input.data.action === 'restart') {
        if (!input.data.month) throw new PlannerFailure('INVALID_MONTH')
        return restartMonthlyPlan(client, business.id, user.id, input.data.month)
      }
      if (input.data.action === 'reset') {
        if (!input.data.month) throw new PlannerFailure('INVALID_MONTH')
        return resetMonthlyPlan(client, business.id, user.id, input.data.month)
      }
      if (input.data.action !== 'prepare' && input.data.action !== 'generate') {
        await client.query(
          'INSERT INTO monthly_planner_settings(business_id,enabled) VALUES($1,$2) ON CONFLICT(business_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()',
          [business.id, input.data.action === 'enable'],
        )
        if (input.data.action === 'enable')
          await client.query(
            "UPDATE monthly_plans SET status='queued',next_run_at=now(),error_code=NULL WHERE business_id=$1 AND status='blocked' AND error_code='PLANNER_PAUSED'",
            [business.id],
          )
        await client.query(
          "INSERT INTO audit_events(business_id,organization_id,actor_id,action,resource_type,resource_id,result,revision) SELECT id,id,$2,$3,'monthly_planner_settings',id::text,'succeeded',revision FROM businesses WHERE id=$1",
          [business.id, user.id, `monthly_plan.${input.data.action}`],
        )
        return { enabled: input.data.action === 'enable' }
      }
      const photoMode = input.data.photoMode || 'auto'
      const selectedAssetIds = photoMode === 'selected' ? input.data.selectedAssetIds || [] : []
      const selectedVideoAssetIds =
        photoMode === 'selected' ? input.data.selectedVideoAssetIds || [] : []
      // Either kind of selection is enough: a video-only batch only needs a
      // chosen video source, and a post-only batch only needs a chosen post
      // source. Only when the user is in `selected` mode and picked neither
      // is a selection genuinely missing.
      if (photoMode === 'selected' && !selectedAssetIds.length && !selectedVideoAssetIds.length)
        throw new PlannerFailure('PHOTO_PREFERENCE_REQUIRED')
      // Each further photograph belongs to exactly one video and is never
      // itself the main photograph of another; an empty list is dropped.
      const videoExtraAssetIds = Object.fromEntries(
        Object.entries(photoMode === 'selected' ? input.data.videoExtraAssetIds || {} : {})
          .filter(([, extras]) => extras.length),
      )
      const extras = Object.values(videoExtraAssetIds).flat()
      if (
        Object.keys(videoExtraAssetIds).some((id) => !selectedVideoAssetIds.includes(id))
        || new Set(extras).size !== extras.length
        || extras.some((id) => selectedVideoAssetIds.includes(id))
      )
        throw createError({ statusCode: 422, message: 'server.REQUEST_INVALID' })
      await client.query(
        `INSERT INTO monthly_planner_settings(
          business_id,enabled,photo_mode,preferred_asset_ids,preferred_video_asset_ids,
          preferred_video_extra_asset_ids,configured_at
        ) VALUES($1,true,$2,$3,$4,$5,now())
        ON CONFLICT(business_id) DO UPDATE
          SET enabled=true,photo_mode=EXCLUDED.photo_mode,
              preferred_asset_ids=EXCLUDED.preferred_asset_ids,
              preferred_video_asset_ids=EXCLUDED.preferred_video_asset_ids,
              preferred_video_extra_asset_ids=EXCLUDED.preferred_video_extra_asset_ids,
              configured_at=now(),updated_at=now()`,
        [business.id, photoMode, selectedAssetIds, selectedVideoAssetIds, JSON.stringify(videoExtraAssetIds)],
      )
      if (input.data.action === 'generate') {
        if (!input.data.month) throw new PlannerFailure('INVALID_MONTH')
        if (!input.data.quantity && !input.data.videoQuantity)
          throw new PlannerFailure('QUANTITY_EXCEEDS_REMAINING')
        return requestMonthlyPosts(
          client,
          business.id,
          user.id,
          input.data.month,
          input.data.quantity ?? 0,
          input.data.channelCounts,
          input.data.videoQuantity,
          input.data.videoChannelCounts,
        )
      }
      return ensureMonthlyPlan(client, business.id, user.id, input.data.month, {
        requeueCancelled: true,
        quantity: input.data.quantity,
        videoQuantity: input.data.videoQuantity,
        channelCounts: input.data.channelCounts,
        videoChannelCounts: input.data.videoChannelCounts,
      })
    })
    setResponseStatus(event, 202)
    return result
  } catch (error) {
    if (error instanceof PlannerFailure)
      throw createError({
        statusCode: error.code === 'CONFIGURATION_REQUIRED' ? 503 : 422,
        message: plannerMessages[error.code] || 'Plani nuk mund të përgatitet tani.',
        data: { code: error.code },
      })
    throw createError({
      statusCode: 500,
      message:
        'server.PLAN_START_FAILED',
      cause: error,
    })
  }
})
