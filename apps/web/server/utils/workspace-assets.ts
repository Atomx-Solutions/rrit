import type { Pool, PoolClient } from 'pg'
import { createError } from 'h3'
import {
  assetUploadMetadataSchema,
  paginatedResponseSchema,
  type AssetMetadataUpdate,
  type AssetUploadMetadata,
  type WorkspaceAssetListQuery,
} from '../../shared/schemas/workspace-resources'
import { assetSchema, type Asset, type Post } from '../../shared/schemas/workspace'
import { recordAuditEvent, transitionMetadata } from './audit'
import { decodePhoto } from './post-validation'
import { assetStorageFolder, assetStoragePath, uploadAsset } from './asset-storage'
import { requireEntitlement, requireQuota } from './trials'

export const MAX_ASSET_UPLOAD_SOURCE_BYTES = 5 * 1024 * 1024
const supportedUploadMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

function fail(message: string): never {
  throw createError({ statusCode: 422, message })
}

type DecodedWorkspaceUploads = Map<string, Awaited<ReturnType<typeof decodePhoto>>>

export type WorkspaceAssetUploadFile = {
  filename: string
  type: string
  data: Buffer
}

type MultipartPart = {
  name?: string
  filename?: string
  type?: string
  data: Buffer
}

export function parseWorkspaceAssetUpload(parts: MultipartPart[]) {
  const allowedNames = new Set(['workspaceRevision', 'name', 'tags', 'rights', 'file'])
  if (
    parts.some((part) => !part.name || !allowedNames.has(part.name)) ||
    new Set(parts.map((part) => part.name)).size !== parts.length
  )
    fail('Formulari i fotografisë nuk është i vlefshëm.')
  const field = (name: string) => parts.find((part) => part.name === name)
  const file = field('file')
  let tags: unknown
  try {
    tags = JSON.parse(field('tags')?.data.toString('utf8') || '')
  } catch {
    fail('Etiketat e fotografisë nuk janë të vlefshme.')
  }
  const metadata = assetUploadMetadataSchema.safeParse({
    workspaceRevision: Number(field('workspaceRevision')?.data.toString('utf8')),
    name: field('name')?.data.toString('utf8'),
    tags,
    rights: field('rights')?.data.toString('utf8') === 'true',
  })
  if (
    !metadata.success ||
    !file?.filename ||
    !supportedUploadMimeTypes.has(file.type || '') ||
    !file.data.length ||
    file.data.length > MAX_ASSET_UPLOAD_SOURCE_BYTES
  )
    fail('Ngarko një fotografi JPEG, PNG ose WebP deri në 5 MB dhe konfirmo të drejtat.')
  return {
    metadata: metadata.data,
    file: { filename: file.filename, type: file.type!, data: file.data },
  }
}

function assetNotFound(): never {
  throw createError({ statusCode: 404, message: 'Fotografia nuk u gjet.' })
}

function assetConflict(): never {
  throw createError({
    statusCode: 409,
    message: 'Ka ndryshime nga një pajisje tjetër. Ngarko versionin e fundit.',
  })
}

async function lockAssetWorkspaceRevision(
  client: PoolClient,
  businessId: string,
  userId: string,
  expectedRevision: number,
) {
  const locked = await client.query<{ revision: number }>(
    'SELECT revision FROM businesses WHERE id=$1 AND owner_id=$2 FOR UPDATE',
    [businessId, userId],
  )
  if (!locked.rows[0]) assetNotFound()
  if (Number(locked.rows[0].revision) !== expectedRevision) assetConflict()
}

type StoredAsset = {
  id: string
  name: string
  tags: string[]
  rights: boolean
  generated: boolean
  size: number | string
  storage_path: string | null
}

async function lockWorkspaceAsset(client: PoolClient, businessId: string, assetId: string) {
  const result = await client.query<StoredAsset>(
    `SELECT id,name,tags,rights,creative_provenance IS NOT NULL AS generated,
            COALESCE(size_bytes,octet_length(bytes))::integer AS size,storage_path
       FROM assets WHERE id=$1 AND business_id=$2 FOR UPDATE`,
    [assetId, businessId],
  )
  if (!result.rows[0]) assetNotFound()
  return result.rows[0]
}

function publicAsset(row: Omit<StoredAsset, 'storage_path'>): Asset {
  return assetSchema.parse({
    ...row,
    size: Number(row.size),
    kind: 'photo',
    url: `/api/media/${row.id}`,
  })
}

async function advanceAssetWorkspaceRevision(
  client: PoolClient,
  businessId: string,
  userId: string,
  expectedRevision: number,
) {
  const saved = await client.query<{ revision: number }>(
    'UPDATE businesses SET revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND revision=$3 RETURNING revision',
    [businessId, userId, expectedRevision],
  )
  if (!saved.rows[0]) assetConflict()
  return Number(saved.rows[0].revision)
}

export async function createWorkspaceAsset(
  client: PoolClient,
  {
    businessId,
    userId,
    slug,
    metadata,
    file,
    uploadedStoragePaths,
  }: {
    businessId: string
    userId: string
    slug: string
    metadata: AssetUploadMetadata
    file: WorkspaceAssetUploadFile
    uploadedStoragePaths: string[]
  },
) {
  await lockAssetWorkspaceRevision(client, businessId, userId, metadata.workspaceRevision)
  if (
    !supportedUploadMimeTypes.has(file.type) ||
    !file.data.length ||
    file.data.length > MAX_ASSET_UPLOAD_SOURCE_BYTES
  )
    fail('Ngarko një fotografi JPEG, PNG ose WebP deri në 5 MB dhe konfirmo të drejtat.')
  const photo = await decodePhoto(file.data)
  await requireEntitlement(businessId, 'media', client)
  await requireQuota(businessId, 'media_storage_bytes', photo.data.length, client)
  const id = crypto.randomUUID()
  const storagePath = assetStoragePath(assetStorageFolder(slug, businessId), file.filename)
  await uploadAsset(storagePath, photo.data)
  uploadedStoragePaths.push(storagePath)
  await client.query(
    "INSERT INTO assets (id,business_id,name,tags,rights,mime,bytes,storage_path,size_bytes,width,height) VALUES ($1,$2,$3,$4,true,'image/jpeg',NULL,$5,$6,$7,$8)",
    [
      id,
      businessId,
      metadata.name,
      JSON.stringify(metadata.tags),
      storagePath,
      photo.data.length,
      photo.info.width,
      photo.info.height,
    ],
  )
  const revision = await advanceAssetWorkspaceRevision(
    client,
    businessId,
    userId,
    metadata.workspaceRevision,
  )
  await recordAuditEvent(client, {
    actorId: userId,
    organizationId: businessId,
    resourceType: 'asset',
    resourceId: id,
    action: 'asset.created',
    revision,
  })
  return {
    asset: publicAsset({
      id,
      name: metadata.name,
      tags: metadata.tags,
      rights: true,
      generated: false,
      size: photo.data.length,
    }),
    workspaceRevision: revision,
  }
}

export async function updateWorkspaceAsset(
  client: PoolClient,
  {
    businessId,
    userId,
    assetId,
    input,
  }: {
    businessId: string
    userId: string
    assetId: string
    input: AssetMetadataUpdate
  },
) {
  await lockAssetWorkspaceRevision(client, businessId, userId, input.workspaceRevision)
  const current = await lockWorkspaceAsset(client, businessId, assetId)
  const next = {
    ...current,
    name: input.name ?? current.name,
    tags: input.tags ?? current.tags,
    rights: input.rights ?? current.rights,
  }
  if (next.rights !== current.rights) {
    const protectedPost = await client.query(
      `SELECT p.id FROM posts p JOIN publication_jobs j ON j.post_id=p.id
        WHERE p.business_id=$1 AND p.payload->>'image'=$2
          AND j.status IN ('processing','uncertain') LIMIT 1`,
      [businessId, `/api/media/${assetId}`],
    )
    if (protectedPost.rows.length)
      fail('Fotografia lidhet me një publikim që pret konfirmim dhe nuk mund të ndryshohet ende.')
  }
  await requireEntitlement(businessId, 'media', client)
  await client.query('UPDATE assets SET name=$1,tags=$2,rights=$3 WHERE id=$4 AND business_id=$5', [
    next.name,
    JSON.stringify(next.tags),
    next.rights,
    assetId,
    businessId,
  ])
  const revision = await advanceAssetWorkspaceRevision(
    client,
    businessId,
    userId,
    input.workspaceRevision,
  )
  await recordAuditEvent(client, {
    actorId: userId,
    organizationId: businessId,
    resourceType: 'asset',
    resourceId: assetId,
    action: 'asset.updated',
    revision,
    metadata: transitionMetadata({ rights: [current.rights, next.rights] }, [
      ...(current.name !== next.name ? ['name'] : []),
      ...(JSON.stringify(current.tags) !== JSON.stringify(next.tags) ? ['tags'] : []),
    ]),
  })
  return {
    asset: publicAsset(next),
    workspaceRevision: revision,
  }
}

export async function deleteWorkspaceAsset(
  client: PoolClient,
  {
    businessId,
    userId,
    assetId,
    workspaceRevision,
  }: {
    businessId: string
    userId: string
    assetId: string
    workspaceRevision: number
  },
) {
  await lockAssetWorkspaceRevision(client, businessId, userId, workspaceRevision)
  const current = await lockWorkspaceAsset(client, businessId, assetId)
  const used = await client.query(
    "SELECT id FROM posts WHERE business_id=$1 AND payload->>'image'=$2 LIMIT 1",
    [businessId, `/api/media/${assetId}`],
  )
  if (used.rows.length) fail('Fotografia përdoret në një postim.')
  await requireEntitlement(businessId, 'media', client)
  await client.query('DELETE FROM assets WHERE id=$1 AND business_id=$2', [assetId, businessId])
  const revision = await advanceAssetWorkspaceRevision(
    client,
    businessId,
    userId,
    workspaceRevision,
  )
  await recordAuditEvent(client, {
    actorId: userId,
    organizationId: businessId,
    resourceType: 'asset',
    resourceId: assetId,
    action: 'asset.deleted',
    revision,
  })
  return {
    deleted: true as const,
    assetId,
    workspaceRevision: revision,
    storagePath: current.storage_path,
  }
}

function literalSearchPattern(search?: string) {
  return search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null
}

export async function listWorkspaceAssets(
  db: Pool | PoolClient,
  businessId: string,
  input: WorkspaceAssetListQuery,
) {
  const values = [businessId, literalSearchPattern(input.search), input.rights ?? null]
  const where = `a.business_id=$1
    AND ($2::text IS NULL OR a.name ILIKE $2 ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(a.tags) AS tag(value)
        WHERE tag.value ILIKE $2 ESCAPE '\\'
      ))
    AND ($3::boolean IS NULL OR a.rights=$3)`
  const count = await db.query(
    `SELECT count(*)::integer AS total FROM assets a WHERE ${where}`,
    values,
  )
  const rows = await db.query(
    `SELECT a.id,a.name,a.tags,a.rights,
       a.creative_provenance IS NOT NULL AS generated,
       COALESCE(a.size_bytes,octet_length(a.bytes))::integer AS size
     FROM assets a WHERE ${where}
     ORDER BY a.created_at DESC, a.id LIMIT $4 OFFSET $5`,
    [...values, input.pageSize, (input.page - 1) * input.pageSize],
  )
  const total = Number(count.rows[0]?.total || 0)
  return paginatedResponseSchema(assetSchema).parse({
    items: rows.rows.map((row) => ({
      ...row,
      size: Number(row.size),
      kind: 'photo',
      url: `/api/media/${row.id}`,
    })),
    page: input.page,
    pageSize: input.pageSize,
    total,
    hasNext: input.page * input.pageSize < total,
  })
}

export async function decodeWorkspaceUploads(assets: Asset[]) {
  const decoded: DecodedWorkspaceUploads = new Map()
  const uploads = assets.filter((asset) => asset.url.startsWith('data:'))
  if (uploads.length) {
    for (const asset of uploads) {
      if (!asset.rights || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(asset.url))
        fail('Ngarko JPG dhe konfirmo të drejtat.')
      const bytes = Buffer.from(asset.url.split(',')[1]!, 'base64')
      if (bytes.length > 2097152) fail('Fotografia tejkalon 2 MB.')
      decoded.set(asset.id, await decodePhoto(bytes))
    }
  }
  return { uploads, decoded }
}

export async function requireWorkspaceAssetQuota(
  client: PoolClient,
  businessId: string,
  decoded: DecodedWorkspaceUploads,
) {
  if (decoded.size)
    await requireQuota(
      businessId,
      'media_storage_bytes',
      [...decoded.values()].reduce((total, photo) => total + photo.data.length, 0),
      client,
    )
}

export async function requireWorkspaceAssetAccess(
  client: PoolClient,
  businessId: string,
  assets: Asset[],
  currentAssets: Asset[],
  currentPosts: Post[],
  inFlightPostIds: string[],
) {
  const protectedImages = currentPosts
    .filter((post) => inFlightPostIds.includes(post.id))
    .map((post) => post.image)
  if (
    currentAssets.some(
      (asset) =>
        protectedImages.includes(asset.url) &&
        !assets.some(
          (next) => next.id === asset.id && next.rights === asset.rights && next.url === asset.url,
        ),
    )
  )
    fail('Fotografia lidhet me një publikim që pret konfirmim dhe nuk mund të ndryshohet ende.')
  if (JSON.stringify(assets) !== JSON.stringify(currentAssets))
    await requireEntitlement(businessId, 'media', client)
}

// Writes use the caller's transaction. The upload journal is shared with the
// caller so files can be removed even if a later database operation fails.
export async function saveWorkspaceAssets(
  client: PoolClient,
  {
    businessId,
    slug,
    assets,
    currentAssets,
    decoded,
    uploadedStoragePaths,
  }: {
    businessId: string
    slug: string
    assets: Asset[]
    currentAssets: Asset[]
    decoded: DecodedWorkspaceUploads
    uploadedStoragePaths: string[]
  },
) {
  const images = new Map<string, string>()
  for (const asset of assets) {
    const previous = currentAssets.find((a) => a.id === asset.id)
    if (asset.name.length > 250 || asset.tags.length > 20 || asset.tags.some((t) => t.length > 100))
      fail('Përdor një emër dhe etiketa më të shkurtra për fotografinë.')
    if (previous) {
      if (asset.url !== previous.url)
        fail('Fotografia ekzistuese nuk mund të zëvendësohet në këtë mënyrë.')
      await client.query(
        'UPDATE assets SET name = $1, tags = $2, rights = $3 WHERE id = $4 AND business_id = $5',
        [asset.name, JSON.stringify(asset.tags), asset.rights, asset.id, businessId],
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
      const storagePath = assetStoragePath(assetStorageFolder(slug, businessId), asset.name)
      await uploadAsset(storagePath, bytes)
      uploadedStoragePaths.push(storagePath)
      await client.query(
        "INSERT INTO assets (id, business_id, name, tags, rights, mime, bytes, storage_path, size_bytes, width, height) VALUES ($1,$2,$3,$4,true,'image/jpeg',NULL,$5,$6,$7,$8)",
        [
          asset.id,
          businessId,
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
  return images
}

export async function removeWorkspaceAssets(
  client: PoolClient,
  {
    businessId,
    assets,
    currentAssets,
    posts,
    removedStoragePaths,
  }: {
    businessId: string
    assets: Asset[]
    currentAssets: Asset[]
    posts: Post[]
    removedStoragePaths: string[]
  },
) {
  const removedAssets = currentAssets.filter(
    (a) => !assets.some((incoming) => incoming.id === a.id),
  )
  if (removedAssets.length) {
    const stored = await client.query(
      'SELECT storage_path FROM assets WHERE id = ANY($1::uuid[]) AND business_id = $2 AND storage_path IS NOT NULL',
      [removedAssets.map((asset) => asset.id), businessId],
    )
    removedStoragePaths.push(...stored.rows.map((row) => row.storage_path as string))
  }
  for (const asset of removedAssets) {
    if (posts.some((p) => p.image === asset.url)) fail('Fotografia përdoret në një postim.')
    await client.query('DELETE FROM assets WHERE id = $1 AND business_id = $2', [
      asset.id,
      businessId,
    ])
  }
}
