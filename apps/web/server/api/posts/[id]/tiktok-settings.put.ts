import { z } from 'zod'
import { connectedTikTok, tiktokCreatorInfo, tiktokSettingsProblem } from '../../../utils/tiktok'

const settingsSchema = z.object({
  privacyLevel: z.string().min(1).max(64),
  disableComment: z.boolean(),
  disableDuet: z.boolean(),
  disableStitch: z.boolean(),
  brandOrganic: z.boolean(),
  brandedContent: z.boolean(),
  // The account holder agreed to TikTok's Music Usage Confirmation, and to the
  // Branded Content Policy when the post promotes a third party.
  consent: z.literal(true),
})

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const input = settingsSchema.safeParse(await boundedBody(event, 2048))
  if (!input.success) throw createError({ statusCode: 422, message: 'server.TIKTOK_SETTINGS_REQUIRED' })
  const { consent: _consent, ...settings } = input.data
  const { connection, videoSeconds } = await withBusinessTransaction(user.id, async (client, business) => {
    const post = await client.query<{ seconds: string | null }>(
      "SELECT payload#>>'{video,durationSeconds}' AS seconds FROM posts WHERE id=$1 AND business_id=$2",
      [id, business.id],
    )
    const seconds = post.rows[0]?.seconds
    return {
      connection: await connectedTikTok(business.id, client),
      videoSeconds: seconds ? Number(seconds) : undefined,
    }
  })
  if (!connection) throw createError({ statusCode: 409, message: 'server.TIKTOK_CONNECTION_REQUIRED' })
  // The options are checked against what the account allows right now.
  const problem = tiktokSettingsProblem(settings, await tiktokCreatorInfo(connection.token), videoSeconds)
  if (problem) throw createError({ statusCode: 422, message: problem })
  await withBusinessTransaction(user.id, async (client, business) => {
    const post = await client.query('SELECT 1 FROM posts WHERE id=$1 AND business_id=$2', [id, business.id])
    if (!post.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
    await client.query(
      `INSERT INTO post_tiktok_settings (post_id,business_id,privacy_level,disable_comment,disable_duet,disable_stitch,brand_organic,branded_content)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (post_id) DO UPDATE SET privacy_level=EXCLUDED.privacy_level,disable_comment=EXCLUDED.disable_comment,
         disable_duet=EXCLUDED.disable_duet,disable_stitch=EXCLUDED.disable_stitch,brand_organic=EXCLUDED.brand_organic,
         branded_content=EXCLUDED.branded_content,updated_at=now()`,
      [id, business.id, settings.privacyLevel, settings.disableComment, settings.disableDuet, settings.disableStitch, settings.brandOrganic, settings.brandedContent],
    )
  })
  return { settings }
})
