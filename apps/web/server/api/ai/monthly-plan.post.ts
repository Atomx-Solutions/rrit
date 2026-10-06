import { z } from 'zod'
import { monthSchema } from '../../../shared/schemas/monthly-plan'
import {
  ensureMonthlyPlan,
  requestMonthlyPosts,
  resetMonthlyPlan,
  restartMonthlyPlan,
} from '../../utils/monthly-planner'
import { PlannerFailure, plannerMessages } from '../../utils/monthly-planner-domain'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const input = z
    .object({
      action: z.enum(['prepare', 'generate', 'restart', 'reset', 'pause', 'enable']),
      month: monthSchema.optional(),
      photoMode: z.enum(['auto', 'selected']).optional(),
      selectedAssetIds: z.array(z.uuid()).max(100).optional(),
      quantity: z.number().int().min(1).max(100).optional(),
      includeTikTokVideos: z.boolean().optional(),
      videoQuantity: z.number().int().min(0).max(100).optional(),
      channelCounts: z
        .object({
          Instagram: z.number().int().min(0).max(100).optional(),
          Facebook: z.number().int().min(0).max(100).optional(),
        })
        .optional(),
    })
    .safeParse(await boundedBody(event, 2048))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'Kërkesa nuk është e vlefshme.' })
  try {
    const result = await withBusinessTransaction(user.id, async (client, business) => {
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
      if (input.data.action === 'restart') {
        if (!input.data.month) throw new PlannerFailure('INVALID_MONTH')
        return restartMonthlyPlan(client, business.id, user.id, input.data.month)
      }
      // Asking an existing plan for more posts. It keeps its research and its
      // drafts; only the newly requested slots are planned and produced.
      if (input.data.action === 'generate') {
        if (!input.data.month) throw new PlannerFailure('INVALID_MONTH')
        if (!input.data.quantity) throw new PlannerFailure('QUANTITY_EXCEEDS_REMAINING')
        return requestMonthlyPosts(
          client,
          business.id,
          user.id,
          input.data.month,
          input.data.quantity,
          input.data.channelCounts,
        )
      }
      if (input.data.action === 'reset') {
        if (!input.data.month) throw new PlannerFailure('INVALID_MONTH')
        return resetMonthlyPlan(client, business.id, user.id, input.data.month)
      }
      if (input.data.action !== 'prepare') {
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
      if (photoMode === 'selected' && !selectedAssetIds.length)
        throw new PlannerFailure('PHOTO_PREFERENCE_REQUIRED')
      await client.query(
        `INSERT INTO monthly_planner_settings(
          business_id,enabled,photo_mode,preferred_asset_ids,configured_at
        ) VALUES($1,true,$2,$3,now())
        ON CONFLICT(business_id) DO UPDATE
          SET enabled=true,photo_mode=EXCLUDED.photo_mode,
              preferred_asset_ids=EXCLUDED.preferred_asset_ids,
              configured_at=now(),updated_at=now()`,
        [business.id, photoMode, selectedAssetIds],
      )
      return ensureMonthlyPlan(client, business.id, user.id, input.data.month, {
        requeueCancelled: true,
        quantity: input.data.quantity,
        channelCounts: input.data.channelCounts,
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
        'Përgatitja nuk u nis për shkak të një problemi të brendshëm. Asnjë plan nuk u aktivizua; provo sërish.',
      cause: error,
    })
  }
})
