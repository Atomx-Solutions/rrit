import { clientSelfServiceDisabled } from '../../utils/client-billing-policy'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  await requireUser(event)
  clientSelfServiceDisabled()
})
