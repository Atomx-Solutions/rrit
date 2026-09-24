import type { Pool, PoolClient } from 'pg'
import { downloadAsset } from './asset-storage'

type AssetDb = Pool | PoolClient
type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export type BrandLogoAsset = {
  id: string
  bytes: Buffer
  mime: SupportedImageMime
}

function imageMime(value: unknown): SupportedImageMime {
  return value === 'image/png' || value === 'image/webp' ? value : 'image/jpeg'
}

/** Loads the latest rights-confirmed logo without making it a generation prerequisite. */
export async function loadBrandLogo(db: AssetDb, businessId: string) {
  const result = await db.query<{
    id: string
    bytes: Buffer | null
    storage_path: string | null
    size_bytes: number | string | null
    mime: string | null
  }>(
    `SELECT id,bytes,storage_path,size_bytes,mime
       FROM assets
      WHERE business_id=$1
        AND kind='brand'
        AND rights=true
        AND (bytes IS NOT NULL OR storage_path IS NOT NULL)
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [businessId],
  )
  const row = result.rows[0]
  if (!row) return undefined

  const size = Number(row.size_bytes)
  if (Number.isFinite(size) && (size < 1 || size > 2097152)) return undefined
  let bytes: Buffer | null = row.bytes
  if (!bytes && row.storage_path) {
    try {
      bytes = await downloadAsset(row.storage_path, 2097152)
    } catch {
      // A logo is an optional enhancement. A stale or unavailable logo must
      // never prevent the rest of the creative from being generated.
      return undefined
    }
  }
  if (!bytes || bytes.length < 1 || bytes.length > 2097152) return undefined

  return { id: row.id, bytes, mime: imageMime(row.mime) } satisfies BrandLogoAsset
}
