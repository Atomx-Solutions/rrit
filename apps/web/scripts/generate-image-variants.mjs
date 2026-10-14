// Generates the responsive WebP variants the landing page references through
// srcset. Run it after replacing any source photo in public/images so the
// widths stay in sync with what the markup requests.
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import sharp from 'sharp'

const publicDir = new URL('../public/', import.meta.url)
const manifestPath = new URL('../shared/image-variants.json', import.meta.url)

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

function variantName(source, width) {
  return source.replace(/\.webp$/, `-${width}w.webp`)
}

let written = 0
for (const entry of manifest.images) {
  const sourcePath = new URL(entry.source, publicDir)
  const source = sharp(await readFile(sourcePath))
  const { width: sourceWidth } = await source.metadata()
  for (const width of entry.widths) {
    if (width > sourceWidth) {
      console.warn(`skip ${entry.source} @ ${width}w: source is only ${sourceWidth}w`)
      continue
    }
    const target = new URL(variantName(entry.source, width), publicDir)
    const buffer = await sharp(await readFile(sourcePath))
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: entry.quality ?? manifest.quality, effort: 6 })
      .toBuffer()
    await writeFile(target, buffer)
    written += 1
    console.log(`${variantName(entry.source, width)} ${Math.round(buffer.byteLength / 1024)} KiB`)
  }
}
console.log(`\n${written} variants written`)
if (!written) process.exitCode = 1
