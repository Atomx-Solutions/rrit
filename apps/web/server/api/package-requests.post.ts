import {
  packageRequestSchema,
  submitPackageRequest,
  submitterHash,
} from '../utils/package-requests'

// The public request form. It is the only unauthenticated write in the app, so
// it stores nothing but the request itself and leans on the database function
// for validation and rate limiting.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const values = packageRequestSchema.safeParse(await boundedBody(event, 4096))
  if (!values.success)
    throw createError({
      statusCode: 400,
      message: 'server.REQUEST_INVALID',
      data: { code: 'REQUEST_INVALID' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return submitPackageRequest({
    values: values.data,
    source: 'landing',
    organizationId: null,
    submitterHash: submitterHash(event),
    userId: null,
  })
})
