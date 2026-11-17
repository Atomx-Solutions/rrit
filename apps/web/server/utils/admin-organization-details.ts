import { adminServiceClient } from './admin-supabase'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isOrganizationId(value: string | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value))
}

export async function adminOrganizationDetails(organizationId: string) {
  const { data, error } = await adminServiceClient().rpc('admin_organization_details', {
    target_organization_id: organizationId,
  })
  if (error) {
    console.error('Admin organization details query failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.ORGANIZATION_DETAILS_LOAD_FAILED' })
  }
  if (!data) return data
  // When and why the organization was closed, and until when it can reopen.
  const closure = await adminServiceClient()
    .from('organizations')
    .select('closed_at, close_reason, purge_after')
    .eq('id', organizationId)
    .maybeSingle()
  if (closure.error) {
    console.error('Admin organization closure query failed.', { code: closure.error.code, message: closure.error.message })
    throw createError({ statusCode: 502, message: 'server.ORGANIZATION_DETAILS_LOAD_FAILED' })
  }
  return { ...(data as Record<string, unknown>), closure: closure.data?.closed_at ? closure.data : null }
}
