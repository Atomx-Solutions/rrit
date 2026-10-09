import {
  appPackageRequestSchema,
  submitPackageRequest,
} from '../../utils/package-requests'
import { businessForUser } from '../../utils/meta'
import { withUserTransaction } from '../../utils/database'

// The same request from inside the app. The organization and the contact both
// come from the session, so neither can be claimed by the request body.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const values = appPackageRequestSchema.safeParse(await boundedBody(event, 4096))
  if (!values.success)
    throw createError({
      statusCode: 400,
      message: 'server.REQUEST_INVALID',
      data: { code: 'REQUEST_INVALID' },
    })
  // Row level security hides the row unless the lookup runs as the signed-in
  // user, so it belongs inside a transaction that sets that context.
  const business = await withUserTransaction(user.id, client =>
    businessForUser(user.id, client),
  )
  setHeader(event, 'Cache-Control', 'private, no-store')
  return submitPackageRequest({
    values: { ...values.data, contactName: user.name, contactEmail: user.email },
    source: 'app',
    organizationId: business.id,
    // Authenticated workspace requests are already scoped to the account.
    // Do not apply the public IP limiter here: shared Wi-Fi/VPNs and repeated
    // client-side retries would otherwise block a legitimate customer.
    submitterHash: null,
    userId: user.id,
  })
})
