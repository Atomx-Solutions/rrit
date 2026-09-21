export default defineEventHandler(() => {
  throw createError({
    statusCode: 404,
    message: 'Admin endpoint nuk u gjet.',
  })
})
