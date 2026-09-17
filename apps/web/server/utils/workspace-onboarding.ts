import type { PoolClient } from 'pg'
import { createError } from 'h3'
import { getBrandBySlug, updateBrand } from './brands'
import { updateWorkspaceMetadata } from './workspace-metadata'
import { updateWorkspacePreferences } from './workspace-preferences'
import { workspaceOnboardingUpdateSchema, type WorkspaceOnboardingUpdate } from '../../shared/schemas/workspace-resources'

export async function saveWorkspaceOnboarding(
  client: PoolClient,
  {
    businessId,
    userId,
    slug,
    input,
  }: {
    businessId: string
    userId: string
    slug: string
    input: WorkspaceOnboardingUpdate
  },
) {
  const parsed = workspaceOnboardingUpdateSchema.safeParse(input)
  if (!parsed.success) throw createError({ statusCode: 422, message: 'Të dhënat e onboarding-ut nuk janë valide.' })
  const currentBrand = await getBrandBySlug(client, businessId, slug)
  if (!currentBrand) throw createError({ statusCode: 404, message: 'Brandi nuk u gjet.' })

  const savedBrand = await updateBrand(client, businessId, currentBrand.id, {
    ...parsed.data.brand,
    revision: parsed.data.brandRevision,
  })
  const savedPreferences = await updateWorkspacePreferences(client, {
    businessId,
    userId,
    slug,
    input: {
      ...parsed.data.preferences,
      workspaceRevision: parsed.data.workspaceRevision,
      brandRevision: savedBrand.revision,
    },
  })
  const savedMetadata = await updateWorkspaceMetadata(client, {
    businessId,
    userId,
    input: {
      ...parsed.data.metadata,
      revision: savedPreferences.workspaceRevision,
    },
  })
  return {
    brand: savedBrand,
    preferences: savedPreferences.preferences,
    metadata: savedMetadata.metadata,
    workspaceRevision: savedMetadata.workspaceRevision,
    brandRevision: savedBrand.revision,
  }
}
