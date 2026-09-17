import { z } from 'zod'
import { setHeader } from 'h3'
import { workspaceSchema } from '../../../shared/schemas/workspace'
import { recordAuditEvent, workspaceAuditMetadata } from '../../utils/audit'
import { removeAsset } from '../../utils/asset-storage'
import {
  requireWorkspacePostQuota,
  requireWorkspacePostAccess,
  saveWorkspacePosts,
} from '../../utils/workspace-posts'
import {
  decodeWorkspaceUploads,
  requireWorkspaceAssetQuota,
  requireWorkspaceAssetAccess,
  saveWorkspaceAssets,
  removeWorkspaceAssets,
} from '../../utils/workspace-assets'
import {
  legacyWorkspacePreferencesSchema,
  saveWorkspacePreferencesAndProfile,
} from '../../utils/workspace-preferences'
import { setTenantContext, setUserContext } from '../../utils/database'
import { BrainFailure, syncBusinessBrain } from '../../utils/business-brain'

const schema = workspaceSchema.extend({
  revision: z.number().int().min(1),
  posts: workspaceSchema.shape.posts.max(1000),
  assets: workspaceSchema.shape.assets.max(500),
  brand: workspaceSchema.shape.brand.extend({
    name: z.string().trim().min(2).max(120),
    city: z.string().max(120),
    industry: z.string().max(200),
    description: z.string().max(2000),
    voice: z.string().max(1000),
    audience: z.string().max(1000),
    facts: workspaceSchema.shape.brand.shape.facts.max(100),
  }),
  preferences: legacyWorkspacePreferencesSchema,
})
const uuid = z.uuid()
function fail(message: string): never {
  throw createError({ statusCode: 422, message })
}

export default defineEventHandler(async (event) => {
  // Temporary compatibility endpoint. New writes must use resource endpoints.
  if (event.node?.res) {
    setHeader(event, 'Deprecation', 'true')
    setHeader(event, 'X-Rrit-Deprecated', 'Use resource-level workspace endpoints.')
  }
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = uuid.safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  const parsed = schema.safeParse(await boundedBody(event))
  if (!parsed.success) fail('Kontrollo fushat. Një vlerë është jashtë kufijve të lejuar.')
  const input = parsed.data
  const client = await database().connect()
  const uploadedStoragePaths: string[] = []
  const removedStoragePaths: string[] = []
  const { uploads, decoded } = await decodeWorkspaceUploads(input.assets)
  try {
    await client.query('BEGIN')
    await setUserContext(client, user.id)
    const owner = await businessForUser(user.id, client)
    if (owner.id !== id.data) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    await setTenantContext(client, { userId: user.id, organizationId: id.data })
    if (uploads.length) await requireEntitlement(id.data, 'media', client)
    const locked = await client.query(
      'SELECT revision FROM businesses WHERE id = $1 AND owner_id = $2 FOR UPDATE',
      [id.data, user.id],
    )
    if (!locked.rows.length) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
    if (locked.rows[0].revision !== input.revision - 1)
      throw createError({
        statusCode: 409,
        message: 'Ka ndryshime nga një pajisje tjetër. Ngarko versionin e fundit.',
      })
    const { workspace: current } = await loadWorkspace(client, id.data, user.id)
    const canonicalBrand = await client.query<{ id: string; revision: number }>(
      'SELECT id, revision FROM brands WHERE organization_id = $1 AND slug = $2 FOR UPDATE',
      [id.data, owner.slug],
    )
    if (canonicalBrand.rows[0] && input.brandRevision !== canonicalBrand.rows[0].revision)
      throw createError({
        statusCode: 409,
        message: 'Brandi ndryshoi nÃ« njÃ« pajisje tjetÃ«r. Ngarko versionin e fundit.',
      })
    input.brand = await syncBusinessBrain(client, id.data, user.id, input.brand, current.brand)
    // Validations in this transaction must see the newly submitted facts too.
    await client.query(
      "UPDATE businesses SET state=jsonb_set(state,'{brand}',$2::jsonb) WHERE id=$1",
      [id.data, JSON.stringify(input.brand)],
    )
    await requireWorkspaceAssetQuota(client, id.data, decoded)
    await requireWorkspacePostQuota(client, id.data, input.posts, current.posts)
    const inFlight = await client.query(
      "SELECT post_id FROM publication_jobs WHERE business_id=$1 AND status IN ('processing','uncertain')",
      [id.data],
    )
    const inFlightPostIds = inFlight.rows.map((job) => job.post_id as string)
    await requireWorkspaceAssetAccess(
      client,
      id.data,
      input.assets,
      current.assets,
      current.posts,
      inFlightPostIds,
    )
    await requireWorkspacePostAccess(client, id.data, input.posts, current.posts)
    if (
      new Set(input.posts.map((p) => p.id)).size !== input.posts.length ||
      new Set(input.assets.map((a) => a.id)).size !== input.assets.length
    )
      fail('Përmbajtja përmban identifikues të përsëritur.')
    if (
      input.posts.some((p) => !uuid.safeParse(p.id).success) ||
      input.assets.some((a) => !uuid.safeParse(a.id).success)
    )
      fail('Identifikues i pavlefshëm.')
    const images = await saveWorkspaceAssets(client, {
      businessId: id.data,
      slug: owner.slug,
      assets: input.assets,
      currentAssets: current.assets,
      decoded,
      uploadedStoragePaths,
    })
    await saveWorkspacePosts(client, {
      businessId: id.data,
      userId: user.id,
      revision: input.revision,
      posts: input.posts,
      currentPosts: current.posts,
      images,
      allowedImages: new Set(
        input.assets.filter((asset) => asset.rights).map((asset) => asset.url),
      ),
      inFlightPostIds,
    })
    await removeWorkspaceAssets(client, {
      businessId: id.data,
      assets: input.assets,
      currentAssets: current.assets,
      posts: input.posts,
      removedStoragePaths,
    })
    const { posts: _posts, assets: _assets, brandRevision: _brandRevision, ...state } = input
    const onboardingComplete =
      current.onboarding >= 4 || input.posts.some((post) => post.status === 'scheduled')
    state.onboarding = onboardingComplete ? 4 : Math.min(input.onboarding, 3)
    const auditMetadata = workspaceAuditMetadata(current, {
      ...input,
      onboarding: state.onboarding,
    })
    state.campaigns = []
    state.strategies = []
    const savedBrandRevision = await saveWorkspacePreferencesAndProfile(client, {
      businessId: id.data,
      userId: user.id,
      state,
      brandRevision: input.brandRevision,
      canonicalBrandId: canonicalBrand.rows[0]?.id,
    })
    if (Object.keys(auditMetadata).length)
      await recordAuditEvent(client, {
        actorId: user.id,
        organizationId: id.data,
        resourceType: 'workspace',
        resourceId: id.data,
        action: 'workspace.updated',
        revision: input.revision,
        metadata: auditMetadata,
      })
    const result = await loadWorkspace(client, id.data, user.id)
    result.workspace.brandRevision = savedBrandRevision
    await client.query('COMMIT')
    for (const storagePath of removedStoragePaths) {
      try {
        await removeAsset(storagePath)
      } catch (error) {
        console.error('Failed to remove deleted asset from storage', { storagePath, error })
      }
    }
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    for (const storagePath of uploadedStoragePaths) {
      try {
        await removeAsset(storagePath)
      } catch (cleanupError) {
        console.error('Failed to clean up uploaded asset after rollback', {
          storagePath,
          cleanupError,
        })
      }
    }
    if (error instanceof BrainFailure) fail(error.message)
    throw error
  } finally {
    client.release()
  }
})
