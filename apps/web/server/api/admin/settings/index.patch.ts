import { platformSettingsChangesSchema, updatePlatformSettings } from '../../../utils/admin-settings'

export default defineEventHandler(async (event) => {
  const changes = platformSettingsChangesSchema.safeParse(await boundedBody(event, 1024))
  if (!changes.success)
    throw createError({
      statusCode: 422,
      message: 'Vlerat e cilësimeve nuk janë të vlefshme.',
      data: { code: 'INVALID_SETTINGS' },
    })
  const actor = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return updatePlatformSettings({ id: actor.id, email: actor.email }, changes.data)
})
