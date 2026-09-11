import { z } from 'zod'
import { workspaceSchema, validateTransition, type Post } from '../../../shared/schemas/workspace'
import { recordAuditEvent, transitionMetadata, workspaceAuditMetadata } from '../../utils/audit'
import {
  postContentSnapshot,
  postContentVersion,
  requireCurrentApproval,
} from '../../utils/post-validation'
import {
  assetStorageFolder,
  assetStoragePath,
  removeAsset,
  uploadAsset,
} from '../../utils/asset-storage'
import { setTenantContext, setUserContext } from '../../utils/database'

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
  preferences: workspaceSchema.shape.preferences.extend({
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
  }),
})
const editableKeys = ['title', 'caption', 'channel', 'format', 'image', 'pillar'] as const
const uuid = z.uuid()
function fail(message: string): never {
  throw createError({ statusCode: 422, message })
}

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = uuid.safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404, message: 'Biznesi nuk u gjet.' })
  const parsed = schema.safeParse(await boundedBody(event))
  if (!parsed.success) fail('Kontrollo fushat. Një vlerë është jashtë kufijve të lejuar.')
  const input = parsed.data
  const client = await database().connect()
  const decoded = new Map<string, Awaited<ReturnType<typeof decodePhoto>>>()
  const uploadedStoragePaths: string[] = []
  const removedStoragePaths: string[] = []
  const uploads = input.assets.filter((asset) => asset.url.startsWith('data:'))
  if (uploads.length) {
    for (const asset of uploads) {
      if (!asset.rights || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(asset.url))
        fail('Ngarko JPG dhe konfirmo të drejtat.')
      const bytes = Buffer.from(asset.url.split(',')[1]!, 'base64')
      if (bytes.length > 2097152) fail('Fotografia tejkalon 2 MB.')
      decoded.set(asset.id, await decodePhoto(bytes))
    }
  }
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
    if (uploads.length)
      await requireQuota(
        id.data,
        'media_storage_bytes',
        [...decoded.values()].reduce((total, photo) => total + photo.data.length, 0),
        client,
      )
    const newPostCount = input.posts.filter(
      (post) => !current.posts.some((existing) => existing.id === post.id),
    ).length
    if (newPostCount) await requireQuota(id.data, 'posts_per_month', newPostCount, client)
    const inFlight = await client.query(
      "SELECT post_id FROM publication_jobs WHERE business_id=$1 AND status IN ('processing','uncertain')",
      [id.data],
    )
    const protectedImages = current.posts
      .filter((post) => inFlight.rows.some((job) => job.post_id === post.id))
      .map((post) => post.image)
    if (
      current.assets.some(
        (asset) =>
          protectedImages.includes(asset.url) &&
          !input.assets.some(
            (next) =>
              next.id === asset.id && next.rights === asset.rights && next.url === asset.url,
          ),
      )
    )
      fail('Fotografia lidhet me një publikim që pret konfirmim dhe nuk mund të ndryshohet ende.')
    if (JSON.stringify(input.assets) !== JSON.stringify(current.assets))
      await requireEntitlement(id.data, 'media', client)
    if (
      input.posts.length !== current.posts.length ||
      input.posts.some((p) => {
        const old = current.posts.find((item) => item.id === p.id)
        return (
          !old ||
          editableKeys.some((key) => old[key] !== p[key]) ||
          old.status !== p.status ||
          old.scheduledAt !== p.scheduledAt
        )
      })
    )
      await requireEntitlement(id.data, 'posts', client)
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
    const images = new Map<string, string>()
    for (const asset of input.assets) {
      const previous = current.assets.find((a) => a.id === asset.id)
      if (
        asset.name.length > 250 ||
        asset.tags.length > 20 ||
        asset.tags.some((t) => t.length > 100)
      )
        fail('Përdor një emër dhe etiketa më të shkurtra për fotografinë.')
      if (previous) {
        if (asset.url !== previous.url)
          fail('Fotografia ekzistuese nuk mund të zëvendësohet në këtë mënyrë.')
        await client.query(
          'UPDATE assets SET name = $1, tags = $2, rights = $3 WHERE id = $4 AND business_id = $5',
          [asset.name, JSON.stringify(asset.tags), asset.rights, asset.id, id.data],
        )
      } else {
        if (!asset.rights || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(asset.url))
          fail('Ngarko një fotografi JPG dhe konfirmo të drejtat.')
        const photo = decoded.get(asset.id)
        if (!photo) fail('Fotografia nuk u verifikua.')
        const bytes = photo.data
        if (
          bytes.length > 2097152 ||
          bytes.length < 4 ||
          bytes[0] !== 255 ||
          bytes[1] !== 216 ||
          bytes[bytes.length - 2] !== 255 ||
          bytes[bytes.length - 1] !== 217
        )
          fail('Fotografia nuk është një JPG i vlefshëm deri në 2 MB.')
        const storagePath = assetStoragePath(assetStorageFolder(owner.slug, id.data), asset.name)
        await uploadAsset(storagePath, bytes)
        uploadedStoragePaths.push(storagePath)
        await client.query(
          "INSERT INTO assets (id, business_id, name, tags, rights, mime, bytes, storage_path, size_bytes, width, height) VALUES ($1,$2,$3,$4,true,'image/jpeg',NULL,$5,$6,$7,$8)",
          [
            asset.id,
            id.data,
            asset.name,
            JSON.stringify(asset.tags),
            storagePath,
            bytes.length,
            photo.info.width,
            photo.info.height,
          ],
        )
        images.set(asset.url, `/api/media/${asset.id}`)
        asset.url = `/api/media/${asset.id}`
      }
    }
    const allowedImages = new Set([...input.assets.filter((a) => a.rights).map((a) => a.url)])
    for (const incoming of input.posts) {
      const previous = current.posts.find((p) => p.id === incoming.id)
      const candidate = { ...incoming, image: images.get(incoming.image) || incoming.image }
      let contentChanged = !previous
      let approvalDecision: 'approved' | 'reopened' | null = null
      let removedFromCalendar = false
      let scheduledOnCalendar = false
      const postChanged =
        !previous ||
        editableKeys.some((key) => candidate[key] !== previous[key]) ||
        candidate.status !== previous.status ||
        candidate.scheduledAt !== previous.scheduledAt ||
        (candidate.publicationMode || 'manual') !== (previous.publicationMode || 'manual')
      if (postChanged && (!candidate.caption.trim() || !allowedImages.has(candidate.image)))
        fail('Plotëso tekstin dhe zgjidh një fotografi me të drejta të konfirmuara.')
      let post: Post
      if (!previous) {
        if (candidate.status !== 'draft') fail('Postimi i ri duhet të nisë si draft.')
        post = {
          ...candidate,
          status: 'draft',
          version: 1,
          contentVersion: 1,
          history: [],
          providerPostId: undefined,
          publishedAt: undefined,
          scheduledAt: null,
          publicationMode: 'manual',
          policy: 'warn',
          policyReason: 'Kontrollo faktet dhe fotografinë përpara miratimit.',
        }
      } else {
        const changed = editableKeys.some((key) => candidate[key] !== previous[key])
        contentChanged = changed
        const statusChanged = candidate.status !== previous.status
        if (
          changed &&
          (!['draft', 'review'].includes(previous.status) || candidate.status !== 'draft')
        )
          fail('Rihap postimin si draft për ta redaktuar.')
        if (statusChanged && !changed) {
          if (inFlight.rows.some((job) => job.post_id === previous.id))
            fail('Publikimi pret konfirmim nga Meta. Kontrollo gjendjen përpara ndryshimit.')
          const error = validateTransition(previous, candidate.status)
          if (error) fail(error)
          if (candidate.status === 'approved' && previous.status !== 'scheduled')
            await requireFreshValidation(previous, id.data, client)
          if (candidate.status === 'approved') approvalDecision = 'approved'
          removedFromCalendar = previous.status === 'scheduled' && candidate.status === 'approved'
          scheduledOnCalendar = previous.status !== 'scheduled' && candidate.status === 'scheduled'
          if (candidate.status === 'draft' && ['approved', 'failed'].includes(previous.status))
            approvalDecision = 'reopened'
          if (candidate.status === 'scheduled') {
            await requireCurrentApproval(previous, id.data, client)
            const checks = await localPostChecks(previous, id.data, client)
            if (checks.some((check) => !check.passed))
              fail(
                checks
                  .filter((check) => !check.passed)
                  .map((check) => check.message)
                  .join(' '),
              )
            if (candidate.publicationMode === 'automatic') {
              await requireEntitlement(id.data, 'publishing', client)
              await requireFreshValidation(previous, id.data, client, 'publication')
              await requirePublishingWorker(client)
            }
          }
          if (previous.status === 'scheduled') {
            const processing = await client.query(
              "SELECT id FROM publication_jobs WHERE post_id=$1 AND status IN ('processing','uncertain') LIMIT 1",
              [previous.id],
            )
            if (processing.rows.length)
              fail(
                'Publikimi ka filluar ose pret konfirmim. Kontrollo gjendjen përpara ndryshimit.',
              )
            await client.query(
              "UPDATE publication_jobs SET status='cancelled',updated_at=now() WHERE post_id=$1 AND status='pending'",
              [previous.id],
            )
          }
        }
        if (!statusChanged && candidate.scheduledAt !== previous.scheduledAt)
          fail('Hiqe postimin nga kalendari përpara ndryshimit të orarit.')
        if (
          !statusChanged &&
          (candidate.publicationMode || 'manual') !== (previous.publicationMode || 'manual')
        )
          fail('Hiqe postimin nga kalendari përpara ndryshimit të mënyrës së publikimit.')
        if (
          candidate.status === 'scheduled' &&
          (statusChanged || candidate.scheduledAt !== previous.scheduledAt) &&
          (!candidate.scheduledAt ||
            !Number.isFinite(Date.parse(candidate.scheduledAt)) ||
            Date.parse(candidate.scheduledAt) <= Date.now())
        )
          fail('Zgjidh një orar të vlefshëm në të ardhmen.')
        post = { ...previous }
        if (changed) {
          for (const key of editableKeys) Object.assign(post, { [key]: candidate[key] })
          post.status = 'draft'
          post.scheduledAt = null
          post.publicationMode = 'manual'
          post.history = [
            ...previous.history,
            { version: previous.version, caption: previous.caption, at: new Date().toISOString() },
          ]
          post.contentVersion = postContentVersion(previous) + 1
          post.policy = 'warn'
          post.policyReason =
            'Përmbajtja ndryshoi. Kontrollo faktet dhe fotografinë përpara miratimit.'
        } else if (statusChanged) {
          post.status = candidate.status
          post.scheduledAt = candidate.status === 'scheduled' ? candidate.scheduledAt : null
          post.publicationMode =
            candidate.status === 'scheduled' ? candidate.publicationMode || 'manual' : 'manual'
        }
        post.version = previous.version + (changed || statusChanged ? 1 : 0)
      }
      if (!previous || editableKeys.some((key) => previous[key] !== post[key])) {
        const checks = await localPostChecks(post, id.data, client)
        post.policy = checks.every((check) => check.passed) ? 'warn' : 'block'
        post.policyReason = checks.every((check) => check.passed)
          ? 'Kontrollet e përmbajtjes kaluan. Konfirmo faktet përpara miratimit. Meta është opsionale për kalendarin.'
          : checks
              .filter((check) => !check.passed)
              .map((check) => check.message)
              .join(' ')
      }
      // Provider-confirmed publication and policy results can never be supplied by this client.
      const saved = await client.query(
        'INSERT INTO posts (id, business_id, payload, content_version) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, content_version = EXCLUDED.content_version, updated_at = now() WHERE posts.business_id = EXCLUDED.business_id',
        [post.id, id.data, JSON.stringify(post), postContentVersion(post)],
      )
      if (!saved.rowCount) fail('Identifikuesi i postimit nuk është i disponueshëm.')
      if (contentChanged) {
        const recorded = await client.query(
          "INSERT INTO post_content_versions (post_id,business_id,content_version,fingerprint,snapshot,source,actor_id) VALUES ($1,$2,$3,$4,$5,'editor',$6) ON CONFLICT DO NOTHING RETURNING post_id",
          [
            post.id,
            id.data,
            postContentVersion(post),
            postFingerprint(post),
            JSON.stringify(postContentSnapshot(post)),
            user.id,
          ],
        )
        if (!recorded.rowCount)
          fail('Versioni i përmbajtjes ekziston tashmë. Ngarko versionin e fundit.')
      }
      if (approvalDecision) {
        await client.query(
          "INSERT INTO post_approval_records (post_id,business_id,content_version,fingerprint,actor_id,decision,source) VALUES ($1,$2,$3,$4,$5,$6,'editor')",
          [
            post.id,
            id.data,
            postContentVersion(post),
            postFingerprint(post),
            user.id,
            approvalDecision,
          ],
        )
        await recordAuditEvent(client, {
          actorId: user.id,
          organizationId: id.data,
          resourceType: 'post',
          resourceId: post.id,
          action: `approval.${approvalDecision}`,
          metadata: {
            ...transitionMetadata({ status: [previous!.status, post.status] }),
            contentVersion: postContentVersion(post),
          },
        })
      }
      if (removedFromCalendar) {
        await recordAuditEvent(client, {
          actorId: user.id,
          organizationId: id.data,
          resourceType: 'post',
          resourceId: post.id,
          action: 'post.unscheduled',
          revision: input.revision,
          metadata: transitionMetadata({
            status: [previous!.status, post.status],
            scheduled_at: [previous!.scheduledAt, post.scheduledAt],
          }),
        })
      }
      if (scheduledOnCalendar) {
        await recordAuditEvent(client, {
          actorId: user.id,
          organizationId: id.data,
          resourceType: 'post',
          resourceId: post.id,
          action: 'post.scheduled',
          revision: input.revision,
          metadata: transitionMetadata({
            status: [previous!.status, post.status],
            scheduled_at: [previous!.scheduledAt, post.scheduledAt],
          }),
        })
      }
      if (
        post.status === 'scheduled' &&
        post.publicationMode === 'automatic' &&
        previous?.status !== 'scheduled'
      )
        await queuePublication(client, post, id.data, post.scheduledAt!)
    }
    if (current.posts.some((p) => !input.posts.some((incoming) => incoming.id === p.id)))
      fail('Heqja e postimeve nuk mbështetet nga ky veprim.')
    const removedAssets = current.assets.filter(
      (a) => !input.assets.some((incoming) => incoming.id === a.id),
    )
    if (removedAssets.length) {
      const stored = await client.query(
        'SELECT storage_path FROM assets WHERE id = ANY($1::uuid[]) AND business_id = $2 AND storage_path IS NOT NULL',
        [removedAssets.map((asset) => asset.id), id.data],
      )
      removedStoragePaths.push(...stored.rows.map((row) => row.storage_path as string))
    }
    for (const asset of removedAssets) {
      if (input.posts.some((p) => p.image === asset.url)) fail('Fotografia përdoret në një postim.')
      await client.query('DELETE FROM assets WHERE id = $1 AND business_id = $2', [
        asset.id,
        id.data,
      ])
    }
    const { posts: _posts, assets: _assets, ...state } = input
    const onboardingComplete =
      current.onboarding >= 4 || input.posts.some((post) => post.status === 'scheduled')
    state.onboarding = onboardingComplete ? 4 : Math.min(input.onboarding, 3)
    const auditMetadata = workspaceAuditMetadata(current, {
      ...input,
      onboarding: state.onboarding,
    })
    state.campaigns = []
    state.strategies = []
    await client.query(
      'UPDATE businesses SET state = $1, revision = $2, updated_at = now() WHERE id = $3 AND owner_id = $4',
      [JSON.stringify(state), input.revision, id.data, user.id],
    )
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
    throw error
  } finally {
    client.release()
  }
})
