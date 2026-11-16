import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDF_ASSET_STORAGE } from '../../shared/utils/pdf-asset-storage'

// A PDF route loads the bundled images (see shared/utils/pdf-asset-storage.ts)
// before it draws, because the function cannot read them from public/.

const cache = new Map<string, Buffer>()

/** Reads the bundled PDF images into memory. Run it before building a PDF. */
export async function loadPdfAssets() {
  const storage = useStorage(PDF_ASSET_STORAGE)
  const keys = await storage.getKeys()
  await Promise.all(keys.map(async (key: string) => {
    if (cache.has(key)) return
    const raw = await storage.getItemRaw(key)
    if (raw) cache.set(key, Buffer.from(raw as Uint8Array))
  }))
}

/**
 * A PDF image's bytes: the bundled copy once loadPdfAssets has run, otherwise
 * the file in public/, which is there in development and in tests.
 */
export function pdfAsset(fileName: string) {
  const loaded = cache.get(fileName)
  if (loaded) return loaded
  const path = [
    resolve(process.cwd(), 'public', fileName),
    resolve(process.cwd(), 'apps/web/public', fileName),
  ].find(candidate => existsSync(candidate))
  if (!path) throw new Error(`The PDF image ${fileName} is missing`)
  const bytes = readFileSync(path)
  cache.set(fileName, bytes)
  return bytes
}
