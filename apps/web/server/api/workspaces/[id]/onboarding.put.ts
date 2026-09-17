import { z } from 'zod'
import { workspaceOnboardingUpdateSchema } from '../../../../shared/schemas/workspace-resources'
import { saveWorkspaceOnboarding } from '../../../utils/workspace-onboarding'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  const parsed = workspaceOnboardingUpdateSchema.safeParse(await boundedBody(event, 64 * 1024))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'Të dhënat e onboarding-ut nuk janë valide.' })
  return withBusinessTransaction(user.id, async (client, business) => {
    if (business.id !== id.data) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    return saveWorkspaceOnboarding(client, {
      businessId: id.data,
      userId: user.id,
      slug: business.slug,
      input: parsed.data,
    })
  })
})
