// The extension a saved file gets from the type of what was downloaded, so a
// PNG is never saved as .jpg and a name without an extension still opens.
const extensionByType: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
}

// Chrome reads the blob URL after click() returns; revoking it at once makes
// the browser fall back to the URL's UUID as the file name, without an
// extension. Long enough for the download to start, short enough not to keep
// large videos in memory.
const revokeDelayMs = 60_000

export function savedFileName(name: string, type: string) {
  const base = name.replace(/[\\/:*?"<>|]+/g, '-').trim()
  const extension = extensionByType[type.split(';')[0]!.trim().toLowerCase()]
  if (!extension) return base
  const known = Object.values(extensionByType)
  const current = base.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
  if (current === extension || (current === 'jpeg' && extension === 'jpg')) return base
  const stem = current && known.includes(current) ? base.slice(0, -current.length - 1) : base
  return `${stem}.${extension}`
}

// `fallbackType` names the file when the server sent no recognised type.
export function saveFile(blob: Blob, name: string, fallbackType = '') {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  const type = extensionByType[blob.type.split(';')[0]!.trim().toLowerCase()] ? blob.type : fallbackType
  anchor.download = savedFileName(name, type)
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs)
}
