export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  const result = await database().query('SELECT id FROM businesses WHERE owner_id = $1', [user.id])
  return {
    user: { id: user.id, name: user.name, email: user.email },
    business: result.rows[0] ? await loadWorkspace(database(), result.rows[0].id, user.id) : null,
  }
})
