import { z } from 'zod'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Fotografia nuk u gjet.' })
  const result = await database().query(
    'SELECT a.bytes, a.mime FROM assets a JOIN businesses b ON b.id = a.business_id WHERE a.id = $1 AND b.owner_id = $2',
    [id.data, user.id],
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, message: 'Fotografia nuk u gjet.' })
  setHeader(event, 'Content-Type', result.rows[0].mime)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return result.rows[0].bytes
})
