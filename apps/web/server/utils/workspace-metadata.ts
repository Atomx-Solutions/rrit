import type { PoolClient } from 'pg'
import { createError } from 'h3'
import { workspaceMetadataUpdateSchema, type WorkspaceMetadataUpdate } from '../../shared/schemas/workspace-resources'
import { recordAuditEvent } from './audit'

export async function updateWorkspaceMetadata(
  client: PoolClient,
  { businessId, userId, input }: { businessId: string; userId: string; input: WorkspaceMetadataUpdate },
) {
  const current = await client.query<{ revision: number; state: Record<string, unknown> }>(
    'SELECT revision,state FROM businesses WHERE id=$1 AND owner_id=$2 FOR UPDATE',
    [businessId, userId],
  )
  if (!current.rows[0]) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  if (Number(current.rows[0].revision) !== input.revision)
    throw createError({ statusCode: 409, message: 'Ka ndryshime nga njÃ« pajisje tjetÃ«r. Ngarko versionin e fundit.' })

  const { revision, ...metadata } = input
  const parsed = workspaceMetadataUpdateSchema.safeParse(input)
  if (!parsed.success) throw createError({ statusCode: 422, message: 'Metadata e pavlefshme.' })
  const saved = await client.query<{ revision: number; state: Record<string, unknown> }>(
    `UPDATE businesses SET state=state || $1::jsonb, revision=revision+1, updated_at=now()
     WHERE id=$2 AND owner_id=$3 AND revision=$4 RETURNING revision,state`,
    [JSON.stringify(metadata), businessId, userId, revision],
  )
  if (!saved.rows[0]) throw createError({ statusCode: 409, message: 'Ka ndryshime nga njÃ« pajisje tjetÃ«r. Ngarko versionin e fundit.' })
  const workspaceRevision = Number(saved.rows[0].revision)
  await recordAuditEvent(client, {
    actorId: userId,
    organizationId: businessId,
    resourceType: 'workspace',
    resourceId: businessId,
    action: 'workspace.metadata.updated',
    revision: workspaceRevision,
    metadata: { fields: Object.keys(metadata) },
  })
  return { workspaceRevision, metadata }
}
