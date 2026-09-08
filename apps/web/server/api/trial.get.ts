export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const result = await database().query('SELECT id FROM businesses WHERE owner_id = $1', [user.id])
  setHeader(event, 'Cache-Control', 'private, no-store')
  return result.rows[0] ? trialStatus(result.rows[0].id) : null
})
