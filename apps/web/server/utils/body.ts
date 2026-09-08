import type { H3Event } from 'h3'
export async function boundedBody(event: H3Event, maxBytes = 12 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes)
      throw createError({
        statusCode: 413,
        message: 'Kërkesa është shumë e madhe. Ngarko më pak fotografi njëherësh.',
      })
    chunks.push(bytes)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw createError({ statusCode: 400, message: 'Të dhënat nuk mund të lexohen.' })
  }
}
