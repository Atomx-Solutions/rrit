export default defineEventHandler(() => {
  throw createError({
    statusCode: 404,
    message: 'server.ADMIN_ENDPOINT_NOT_FOUND',
  })
})
