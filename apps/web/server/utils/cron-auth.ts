import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

// Vercel Cron sends the project's CRON_SECRET as a bearer token; nothing else
// may start a cron's work.
export function requireCronSecret(event: H3Event) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('A cron was called but CRON_SECRET is not set.', { path: event.path })
    throw createError({ statusCode: 401, message: 'server.ACCESS_DENIED' })
  }
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(getHeader(event, 'authorization') || '')
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    throw createError({ statusCode: 401, message: 'server.ACCESS_DENIED' })
}
