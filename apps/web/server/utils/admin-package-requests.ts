import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

export const packageRequestStatusSchema = z.enum(['new', 'contacted', 'proposal_sent', 'won', 'lost'])
export const packageRequestChangeSchema = z
  .object({
    status: packageRequestStatusSchema,
    note: z.string().trim().max(2000).optional(),
    organizationId: z.uuid().nullable().optional(),
  })
  .strict()

const failures: Record<string, { statusCode: number; message: string }> = {
  REQUEST_NOT_FOUND: { statusCode: 404, message: 'Kërkesa nuk u gjet.' },
  REQUEST_INVALID: { statusCode: 400, message: 'Vlerat e kërkesës nuk janë të vlefshme.' },
}

export function adminPackageRequestFailure(message: string | undefined) {
  const failure = message ? failures[message] : undefined
  return failure ? { ...failure, code: message! } : null
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await adminServiceClient().rpc(name, args)
  if (error) {
    const failure = adminPackageRequestFailure(error.message)
    if (failure)
      throw createError({
        statusCode: failure.statusCode,
        message: failure.message,
        data: { code: failure.code },
      })
    console.error('Admin package request call failed.', {
      name,
      code: error.code,
      message: error.message,
    })
    throw createError({ statusCode: 502, message: 'Kërkesat nuk u ngarkuan.' })
  }
  return data as Record<string, unknown>
}

export function adminPackageRequests(status?: string) {
  return rpc('admin_package_requests', { p_status: status ?? null })
}

export function deletePackageRequest(requestId: string, actor: { id: string, email: string }) {
  return rpc('admin_delete_package_request', {
    p_request_id: requestId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
  })
}

export function updatePackageRequest(
  requestId: string,
  actor: { id: string; email: string },
  change: z.infer<typeof packageRequestChangeSchema>,
) {
  return rpc('admin_update_package_request', {
    p_request_id: requestId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_status: change.status,
    p_note: change.note ?? null,
    p_organization_id: change.organizationId ?? null,
  })
}
