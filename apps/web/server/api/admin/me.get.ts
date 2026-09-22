// The superadmin server middleware already rejects non-superadmins on every
// /api/admin/** request with 401/403, so reaching this handler means access.
export default defineEventHandler(async (event) => {
  const user = (event.context.superadmin as { email: string } | undefined) ?? await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { ok: true as const, email: user.email }
})
