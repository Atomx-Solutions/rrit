import type { PoolClient } from 'pg'
import { createError } from 'h3'
import { z } from 'zod'
import {
  workspacePreferencesResponseSchema,
  workspacePreferencesSchema,
  type PreferencesUpdate,
} from '../../shared/schemas/workspace-resources'
import { workspaceSchema, type Workspace } from '../../shared/schemas/workspace'
import { recordAuditEvent, transitionMetadata } from './audit'
import { getBrandBySlug, updateBrand } from './brands'

export const legacyWorkspacePreferencesSchema = workspaceSchema.shape.preferences.extend({
  name: z.string().min(2).max(100),
  email: z.email(),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('sq', { timeZone: value })
      return true
    } catch {
      return false
    }
  }),
})

function preferencesNotFound(): never {
  throw createError({ statusCode: 404, message: 'Preferencat nuk u gjetën.' })
}

function preferencesConflict(
  message = 'Ka ndryshime nga një pajisje tjetër. Ngarko versionin e fundit.',
): never {
  throw createError({ statusCode: 409, message })
}

function canonicalPreferences(
  statePreferences: unknown,
  brand: NonNullable<Awaited<ReturnType<typeof getBrandBySlug>>>,
) {
  const workspace = workspacePreferencesSchema.parse(statePreferences)
  return workspacePreferencesSchema.parse({
    ...workspace,
    timezone: brand.timezone,
    locale: brand.locale,
    emailApprovals: brand.settings.emailApprovals,
    emailPublished: brand.settings.emailPublished,
    emailTips: brand.settings.emailTips,
  })
}

export async function getWorkspacePreferences(
  client: PoolClient,
  { businessId, userId, slug }: { businessId: string; userId: string; slug: string },
) {
  const business = await client.query<{ state: { preferences?: unknown }; revision: number }>(
    'SELECT state,revision FROM businesses WHERE id=$1 AND owner_id=$2',
    [businessId, userId],
  )
  if (!business.rows[0]) preferencesNotFound()
  const brand = await getBrandBySlug(client, businessId, slug)
  if (!brand) preferencesNotFound()
  return workspacePreferencesResponseSchema.parse({
    preferences: canonicalPreferences(business.rows[0].state.preferences, brand),
    workspaceRevision: Number(business.rows[0].revision),
    brandRevision: brand.revision,
  })
}

export async function updateWorkspacePreferences(
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
    input: PreferencesUpdate
  },
) {
  const business = await client.query<{ state: { preferences?: unknown }; revision: number }>(
    'SELECT revision,state FROM businesses WHERE id=$1 AND owner_id=$2 FOR UPDATE',
    [businessId, userId],
  )
  if (!business.rows[0]) preferencesNotFound()
  if (Number(business.rows[0].revision) !== input.workspaceRevision) preferencesConflict()
  const currentBrand = await getBrandBySlug(client, businessId, slug)
  if (!currentBrand) preferencesNotFound()
  if (currentBrand.revision !== input.brandRevision)
    preferencesConflict('Brandi ndryshoi në një pajisje tjetër. Ngarko versionin e fundit.')

  const current = canonicalPreferences(business.rows[0].state.preferences, currentBrand)
  const { workspaceRevision, brandRevision, ...changes } = input
  const next = workspacePreferencesSchema.parse({ ...current, ...changes })
  const brandFieldsChanged =
    next.timezone !== current.timezone ||
    next.locale !== current.locale ||
    next.emailApprovals !== current.emailApprovals ||
    next.emailPublished !== current.emailPublished ||
    next.emailTips !== current.emailTips
  const savedBrand = brandFieldsChanged
    ? await updateBrand(client, businessId, currentBrand.id, {
        revision: brandRevision,
        timezone: next.timezone,
        locale: next.locale,
        settings: {
          emailApprovals: next.emailApprovals,
          emailPublished: next.emailPublished,
          emailTips: next.emailTips,
        },
      })
    : currentBrand

  const savedBusiness = await client.query<{ revision: number }>(
    `UPDATE businesses SET state=jsonb_set(state,'{preferences}',$1::jsonb),
       revision=revision+1,updated_at=now()
     WHERE id=$2 AND owner_id=$3 AND revision=$4 RETURNING revision`,
    [JSON.stringify(next), businessId, userId, workspaceRevision],
  )
  if (!savedBusiness.rows[0]) preferencesConflict()
  const savedWorkspaceRevision = Number(savedBusiness.rows[0].revision)
  await recordAuditEvent(client, {
    actorId: userId,
    organizationId: businessId,
    resourceType: 'workspace_preferences',
    resourceId: businessId,
    action: 'preferences.updated',
    revision: savedWorkspaceRevision,
    metadata: transitionMetadata(
      {
        timezone: [current.timezone, next.timezone],
        locale: [current.locale, next.locale],
      },
      [
        ...(current.name !== next.name || current.email !== next.email ? ['account_profile'] : []),
        ...(current.emailApprovals !== next.emailApprovals ||
        current.emailPublished !== next.emailPublished ||
        current.emailTips !== next.emailTips
          ? ['notification_settings']
          : []),
      ],
    ),
  })
  return workspacePreferencesResponseSchema.parse({
    preferences: next,
    workspaceRevision: savedWorkspaceRevision,
    brandRevision: savedBrand.revision,
  })
}

// Legacy preferences share the business profile record and its canonical brand
// projection. Keep both writes in the caller's transaction, with the same SQL
// and revision behavior; this is not the new partial preferences API.
export async function saveWorkspacePreferencesAndProfile(
  client: PoolClient,
  {
    businessId,
    userId,
    state,
    brandRevision,
    canonicalBrandId,
  }: {
    businessId: string
    userId: string
    state: Omit<Workspace, 'posts' | 'assets' | 'brandRevision'>
    brandRevision: number
    canonicalBrandId?: string
  },
) {
  await client.query(
    'UPDATE businesses SET state = $1, revision = $2, updated_at = now() WHERE id = $3 AND owner_id = $4',
    [JSON.stringify(state), state.revision, businessId, userId],
  )
  let savedBrandRevision = brandRevision
  if (canonicalBrandId) {
    const { name: _name, status: _status, ...brandProfile } = state.brand
    const savedBrand = await client.query<{ revision: number }>(
      `UPDATE brands
       SET name=$1, profile=$2, settings=$3, timezone=$4, locale=$5, category=$6,
           status=$7,
           archived_at=CASE WHEN $7='archived' THEN COALESCE(archived_at, now()) ELSE NULL END,
           revision=revision+1, updated_at=now()
       WHERE id=$8 AND organization_id=$9 AND revision=$10
       RETURNING revision`,
      [
        state.brand.name,
        JSON.stringify(brandProfile),
        JSON.stringify({
          emailApprovals: state.preferences.emailApprovals,
          emailPublished: state.preferences.emailPublished,
          emailTips: state.preferences.emailTips,
        }),
        state.preferences.timezone,
        state.preferences.locale,
        state.brand.industry.trim() || 'general',
        state.brand.status,
        canonicalBrandId,
        businessId,
        brandRevision,
      ],
    )
    if (!savedBrand.rows[0])
      throw createError({
        statusCode: 409,
        message: 'Brandi ndryshoi nÃ« njÃ« pajisje tjetÃ«r. Ngarko versionin e fundit.',
      })
    savedBrandRevision = savedBrand.rows[0].revision
  }
  return savedBrandRevision
}
