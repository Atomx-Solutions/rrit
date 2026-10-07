import { createError } from 'h3'

/** Client package changes and credit purchases are handled only by superadmins. */
export function clientSelfServiceDisabled(): never {
  throw createError({
    statusCode: 403,
    message: 'server.BILLING_MANAGED_BY_ADMIN',
    data: { code: 'CLIENT_SELF_SERVICE_DISABLED' },
  })
}
