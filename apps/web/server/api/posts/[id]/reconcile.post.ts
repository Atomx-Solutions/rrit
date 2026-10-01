import { z } from 'zod'
import { reconcileUncertainPublication } from '../../../utils/publishing'
import { MetaFailure } from '../../../utils/meta'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const business = await withUserTransaction(user.id, (contextClient) =>
    businessForUser(user.id, contextClient),
  )
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404 })
  try {
    return await withBusinessTransaction(user.id, (client, currentBusiness) => {
      if (currentBusiness.id !== business.id)
        throw createError({ statusCode: 409, message: 'Biznesi ndryshoi. Provo sërish.' })
      return reconcileUncertainPublication(id.data, business.id, client)
    })
  } catch (error) {
    if (error instanceof MetaFailure)
      throw createError({
        statusCode: 502,
        message:
          'Meta nuk e konfirmoi rezultatin. Postimi mbetet i bllokuar nga ridërgimi; provo kontrollin përsëri.',
      })
    throw error
  }
})
