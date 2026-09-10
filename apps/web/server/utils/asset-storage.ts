import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_BUCKET = 'assets'

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

export async function downloadAsset(path: string) {
  const { data, error } = await storageClient().storage.from(assetBucket()).download(path)
  if (error || !data) throw createError({ statusCode: 404, message: 'Fotografia nuk u gjet.' })
  return Buffer.from(await data.arrayBuffer())
}

export async function removeAsset(path: string) {
  const { error } = await storageClient().storage.from(assetBucket()).remove([path])
  if (error) throw new Error(`Asset cleanup failed: ${error.message}`)
}
