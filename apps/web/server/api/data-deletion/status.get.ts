// The status URL returned to Meta with each data deletion confirmation.
export default defineEventHandler(async (event) => {
  const code = getQuery(event).code
  if (typeof code !== 'string' || !/^[a-f0-9]{32}$/.test(code))
    throw createError({ statusCode: 404 })
  const deletion = await providerDataDeletionStatus(code)
  if (!deletion) throw createError({ statusCode: 404 })
  setHeader(event, 'Cache-Control', 'no-store')
  return { confirmationCode: code, status: 'completed', completedAt: deletion.completed_at.toISOString() }
})
