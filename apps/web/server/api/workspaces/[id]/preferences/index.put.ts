import { z } from 'zod'
import { preferencesUpdateSchema } from '../../../../../shared/schemas/workspace-resources'
import { updateWorkspacePreferences } from '../../../../utils/workspace-preferences'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  const input = preferencesUpdateSchema.safeParse(await boundedBody(event, 4096))
  if (!input.success) throw createError({ statusCode: 422, message: 'Kontrollo preferencat.' })

  return withBusinessTransaction(user.id, (client, business) => {
    if (business.id !== id.data)
      throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return updateWorkspacePreferences(client, {
      businessId: id.data,
      userId: user.id,
      slug: business.slug,
      input: input.data,
    })
  })
})
