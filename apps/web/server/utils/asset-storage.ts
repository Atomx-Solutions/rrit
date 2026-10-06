import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_BUCKET = 'assets'
export const MAX_ASSET_BYTES = 2097152
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15000

let client: SupabaseClient | undefined

function storageClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key)
    throw createError({ statusCode: 503, message: 'Asset storage nuk është konfiguruar.' })
  return (client ||= createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  }))
}

export function assetBucket() {
  return process.env.MEDIA_BUCKET || DEFAULT_BUCKET
}

function assetDownloadTimeoutMs() {
  const configured = Number(
    process.env.ASSET_STORAGE_DOWNLOAD_TIMEOUT_MS || DEFAULT_DOWNLOAD_TIMEOUT_MS,
  )
  return Number.isFinite(configured) && configured >= 1000
    ? Math.min(Math.floor(configured), 60000)
    : DEFAULT_DOWNLOAD_TIMEOUT_MS
}

export function assetStorageFolder(slug: string, businessId: string) {
  return `${slug}-${businessId}`
}

function safeOriginalStem(name: string) {
  const base = name.split(/[\\/]/).pop() || 'asset'
  const stem = base.replace(/\.[^.]+$/, '')
  const normalized = stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'asset'
}

export function assetStoragePath(folder: string, originalName: string, uploadedAt = new Date()) {
  const timestamp = uploadedAt.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')
  return `${folder}/${safeOriginalStem(originalName)}_${timestamp}.jpg`
}

export async function uploadAsset(path: string, bytes: Buffer) {
  const { error } = await storageClient().storage.from(assetBucket()).upload(path, bytes, {
    contentType: 'image/jpeg',
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw createError({ statusCode: 502, message: 'Fotografia nuk u ruajt në storage.' })
}

// Video renders are private derived assets, not gallery photos. Keep their MIME
// type explicit so storage and future signed-download routes never mislabel MP4.
export async function uploadBinaryAsset(path: string, bytes: Buffer, contentType: string) {
  const { error } = await storageClient().storage.from(assetBucket()).upload(path, bytes, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw createError({ statusCode: 502, message: 'Videoja nuk u ruajt në storage.' })
}

export async function downloadAsset(path: string, maxBytes = MAX_ASSET_BYTES) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), assetDownloadTimeoutMs())
  try {
    const { data, error } = await storageClient()
      .storage.from(assetBucket())
      .download(path, {}, { signal: controller.signal, cache: 'no-store' })
    if (error || !data) throw createError({ statusCode: 404, message: 'Fotografia nuk u gjet.' })
    if (data.size > maxBytes)
      throw createError({ statusCode: 413, message: 'Fotografia tejkalon kufirin e lejuar.' })
    const bytes = Buffer.from(await data.arrayBuffer())
    if (bytes.length > maxBytes) {
      bytes.fill(0)
      throw createError({ statusCode: 413, message: 'Fotografia tejkalon kufirin e lejuar.' })
    }
    return bytes
  } catch (error) {
    if (controller.signal.aborted)
      throw createError({ statusCode: 504, message: 'Shkarkimi i fotografisë zgjati shumë.' })
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function removeAsset(path: string) {
  const { error } = await storageClient().storage.from(assetBucket()).remove([path])
  if (error) throw new Error(`Asset cleanup failed: ${error.message}`)
}
