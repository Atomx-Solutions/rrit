import { z } from 'zod'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const input = z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(10),
      channel: z.enum(['all', 'Facebook', 'Instagram']).default('all'),
      search: z.string().trim().max(200).default(''),
    })
    .safeParse(getQuery(event))
  if (!input.success) throw createError({ statusCode: 422, message: 'Filtër i pavlefshëm.' })
  const { page, pageSize, channel, search } = input.data
  const result = await withBusinessTransaction(user.id, async (client, business) => {
    const values = [business.id, channel, search]
    const where =
      "sp.business_id=$1 AND ($2='all' OR sp.channel=$2) AND ($3='' OR strpos(lower(sp.caption),lower($3))>0) AND EXISTS (SELECT 1 FROM meta_connections mc WHERE mc.business_id=sp.business_id AND mc.status='connected' AND ((sp.channel='Facebook' AND sp.source_account_id=mc.page_id) OR (sp.channel='Instagram' AND sp.source_account_id=mc.instagram_id)))"
    const count = await client.query(
      `SELECT count(*)::integer AS total FROM social_posts sp WHERE ${where}`,
      values,
    )
    const rows = await client.query(
      `SELECT sp.id::text, sp.channel, sp.caption, sp.media_url AS image, sp.permalink, sp.published_at AS "publishedAt", sp.media_type AS "mediaType" FROM social_posts sp WHERE ${where} ORDER BY sp.published_at DESC, sp.id DESC LIMIT $4 OFFSET $5`,
      [...values, pageSize, (page - 1) * pageSize],
    )
    return { rows, total: count.rows[0].total as number }
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    posts: result.rows.rows as {
      id: string
      channel: 'Facebook' | 'Instagram'
      caption: string
      image: string | null
      permalink: string | null
      publishedAt: string
      mediaType: string
    }[],
    total: result.total,
  }
})
