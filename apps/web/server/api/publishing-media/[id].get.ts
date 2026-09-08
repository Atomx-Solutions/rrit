import { z } from 'zod'
export default defineEventHandler(async (event) => {
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const query = getQuery(event)
  if (
    !id.success ||
    typeof query.expires !== 'string' ||
    typeof query.signature !== 'string' ||
    !validMediaSignature(id.data, query.expires, query.signature)
  )
    throw createError({ statusCode: 404 })
  const row = await database().query('SELECT bytes FROM assets WHERE id=$1 AND rights=true', [
    id.data,
  ])
  if (!row.rows[0]) throw createError({ statusCode: 404 })
  setHeader(event, 'Content-Type', 'image/jpeg')
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  return row.rows[0].bytes as Buffer
})
