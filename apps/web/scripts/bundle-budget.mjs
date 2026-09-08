import { readdir, stat, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../.output/public/_nuxt/', import.meta.url))
const files = []
async function walk(dir) {
  for (const file of await readdir(dir)) {
    const path = join(dir, file)
    if ((await stat(path)).isDirectory()) await walk(path)
    else if (/\.(js|css)$/.test(file)) {
      const data = await readFile(path)
      files.push({ file, bytes: data.length, gzip: gzipSync(data).length })
    }
  }
}
await walk(root)
files.sort((a, b) => b.gzip - a.gzip)
const report = {
  generatedAt: new Date().toISOString(),
  totalGzip: files.reduce((sum, f) => sum + f.gzip, 0),
  files,
}
await writeFile(new URL('../bundle-report.json', import.meta.url), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ totalGzip: report.totalGzip, largest: files.slice(0, 8) }, null, 2))
// Route-split total is observed; single critical assets have hard regression limits.
if (
  files.some((f) => f.file.endsWith('.js') && f.gzip > 220 * 1024) ||
  files.some((f) => f.file.endsWith('.css') && f.gzip > 80 * 1024)
) {
  console.error('An individual asset exceeds the reviewed compressed budget.')
  process.exitCode = 1
}
