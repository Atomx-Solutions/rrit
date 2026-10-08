import type { PoolClient } from 'pg'
import type { Workspace } from '../../shared/schemas/workspace'
import type { Brand } from '../../shared/schemas/brand'

type AuditPrimitive = string | number | boolean | null
type AuditValue = AuditPrimitive | AuditMetadata | AuditValue[]
export interface AuditMetadata {
  [key: string]: AuditValue
}

export type AuditEventInput = {
  actorId: string
  organizationId: string
  resourceType: string
  resourceId: string
  action: string
  result?: 'succeeded' | 'failed' | 'denied' | 'cancelled'
  metadata?: AuditMetadata
  revision?: number
}

const forbiddenMetadataKey = /(token|secret|password|api.?key|credential|authorization|cookie|ciphertext|private.?key)/i
const tokenLikeValue = /(^bearer\s|^eyJ[A-Za-z0-9_-]{10,})/i

function sanitizeValue(value: unknown, depth = 0): AuditValue {
  if (depth > 8) throw createError({ statusCode: 500, message: 'server.AUDIT_METADATA_TOO_DEEP' })
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw createError({ statusCode: 500, message: 'server.AUDIT_METADATA_INVALID' })
    return value
  }
  if (typeof value === 'string') {
    if (value.length > 500 || tokenLikeValue.test(value))
      throw createError({ statusCode: 500, message: 'server.AUDIT_SENSITIVE_DATA' })
    return value
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1))
  if (typeof value === 'object' && value) {
    const next: AuditMetadata = {}
    for (const [key, nested] of Object.entries(value)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || forbiddenMetadataKey.test(key))
        throw createError({ statusCode: 500, message: 'server.AUDIT_SENSITIVE_DATA' })
      next[key] = sanitizeValue(nested, depth + 1)
    }
    return next
  }
  throw createError({ statusCode: 500, message: 'server.AUDIT_METADATA_INVALID' })
}

export function sanitizeAuditMetadata(metadata: AuditMetadata = {}): AuditMetadata {
  const result = sanitizeValue(metadata)
  if (Array.isArray(result) || !result || typeof result !== 'object')
    throw createError({ statusCode: 500, message: 'server.AUDIT_METADATA_NOT_OBJECT' })
  const serialized = JSON.stringify(result)
  if (Buffer.byteLength(serialized, 'utf8') > 4096)
    throw createError({ statusCode: 500, message: 'server.AUDIT_METADATA_TOO_LARGE' })
  return result
}

function differs(left: unknown, right: unknown) {
  return JSON.stringify(left) !== JSON.stringify(right)
}

/**
 * Returns only stable field categories, never the previous or next values.
 * This keeps a workspace audit event useful without copying profile, post, or
 * preference content into the audit ledger.
 */
export function workspaceChangedFields(current: Workspace, input: Workspace): string[] {
  const changedFields: string[] = []
  if (current.brand.name !== input.brand.name) changedFields.push('business_name')

  const { name: _currentName, ...currentBrandProfile } = current.brand
  const { name: _inputName, ...inputBrandProfile } = input.brand
  if (differs(currentBrandProfile, inputBrandProfile)) changedFields.push('brand_profile')

  if (differs(current.preferences, input.preferences)) changedFields.push('preferences')

  const currentPosts = current.posts.map((post) => ({
    id: post.id,
    title: post.title,
    caption: post.caption,
    channel: post.channel,
    format: post.format,
    image: post.image,
    pillar: post.pillar,
    status: post.status,
    scheduledAt: post.scheduledAt,
    publicationMode: post.publicationMode || 'manual',
  }))
  const inputPosts = input.posts.map((post) => ({
    id: post.id,
    title: post.title,
    caption: post.caption,
    channel: post.channel,
    format: post.format,
    image: post.image,
    pillar: post.pillar,
    status: post.status,
    scheduledAt: post.scheduledAt,
    publicationMode: post.publicationMode || 'manual',
  }))
  if (differs(currentPosts, inputPosts)) changedFields.push('posts')
  if (differs(current.assets, input.assets)) changedFields.push('assets')
  if (current.onboarding !== input.onboarding) changedFields.push('onboarding')
  if (differs(current.dismissed, input.dismissed) || current.notificationsRead !== input.notificationsRead)
    changedFields.push('workspace_preferences')

  return changedFields
}

export function workspaceAuditMetadata(current: Workspace, input: Workspace): AuditMetadata {
  const changedFields = workspaceChangedFields(current, input)
  const changes: AuditMetadata = {}
  const trackValue = (field: string, before: string, after: string) => {
    if (before !== after) changes[field] = { before, after }
  }

  // These are short, public-facing business attributes. Free-form profile
  // content, emails, social URLs, posts, and assets stay category-only so an
  // audit event cannot become a second store of PII or credentials.
  trackValue('business_name', current.brand.name, input.brand.name)
  trackValue('city', current.brand.city, input.brand.city)
  trackValue('industry', current.brand.industry, input.brand.industry)
  trackValue('color', current.brand.color, input.brand.color)

  return changedFields.length
    ? {
        changedFields,
        ...(Object.keys(changes).length ? { changes } : {}),
      }
    : {}
}

export function transitionMetadata(
  transitions: Record<string, readonly [AuditPrimitive, AuditPrimitive]>,
  categoryOnlyFields: string[] = [],
): AuditMetadata {
  const changes: AuditMetadata = {}
  for (const [field, [before, after]] of Object.entries(transitions)) {
    if (before !== after) changes[field] = { before, after }
  }
  const changedFields = [...Object.keys(changes), ...categoryOnlyFields]
  return {
    ...(changedFields.length ? { changedFields } : {}),
    ...(Object.keys(changes).length ? { changes } : {}),
  }
}

export function brandAuditMetadata(before: Brand, after: Brand): AuditMetadata {
  const profileContentChanged = [
    'description',
    'voice',
    'audience',
    'facebookUrl',
    'instagramUrl',
    'facts',
  ].some((field) => differs(before.profile[field as keyof typeof before.profile], after.profile[field as keyof typeof after.profile]))
  return transitionMetadata(
    {
      name: [before.name, after.name],
      slug: [before.slug, after.slug],
      city: [before.profile.city, after.profile.city],
      industry: [before.profile.industry, after.profile.industry],
      color: [before.profile.color, after.profile.color],
      category: [before.category, after.category],
      timezone: [before.timezone, after.timezone],
      locale: [before.locale, after.locale],
    },
    profileContentChanged ? ['profile_content'] : [],
  )
}

export async function recordAuditEvent(client: PoolClient, input: AuditEventInput) {
  const metadata = sanitizeAuditMetadata(input.metadata)
  const result = await client.query<{ record_audit_event: string }>(
    'SELECT app.record_audit_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS record_audit_event',
    [
      input.actorId,
      input.organizationId,
      input.organizationId,
      input.resourceType,
      input.resourceId,
      input.action,
      input.result || 'succeeded',
      JSON.stringify(metadata),
      input.revision || 0,
    ],
  )
  return Number(result.rows[0]!.record_audit_event)
}
