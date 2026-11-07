import { z } from 'zod'
import { tiktokPostSettings } from '../../../utils/tiktok-publishing'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().parse(getRouterParam(event, 'id'))
  const settings = await withBusinessTransaction(user.id, (client, business) =>
    tiktokPostSettings(id, business.id, client),
  )
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { settings }
})
