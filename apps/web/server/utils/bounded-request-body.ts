import { createError } from 'h3'
import type { Readable } from 'node:stream'

export function readBodyWithinLimit(request: Readable, maximumBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    const cleanup = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
    }
    const onError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks, size))
    }
    const onData = (chunk: Buffer | Uint8Array | string) => {
      if (settled) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > maximumBytes) {
        settled = true
        cleanup()
        // Drain the remaining socket data without retaining it in memory.
        request.once('error', () => undefined)
        request.resume()
        reject(createError({ statusCode: 413, message: 'Fotografia tejkalon kufirin e lejuar.' }))
        return
      }
      chunks.push(bytes)
    }

    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
  })
}
