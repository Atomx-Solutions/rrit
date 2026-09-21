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
    throw createError({ statusCode: 502, message: 'Detajet e organizatës nuk u ngarkuan.' })
  }
  return data
}
