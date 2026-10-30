import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'
import { MAX_ASSET_BYTES, removeAsset } from './asset-storage'

export const FEEDBACK_MAX_PHOTOS = 3
export const feedbackCategorySchema = z.enum(['bug', 'feature', 'improvement', 'other'])

// Photos arrive as JPEG data URLs: the browser already scales and re-encodes
// them, so the server only checks that what it stores really is a small JPEG.
export const clientFeedbackSchema = z
  .object({
    organizationId: z.uuid(),
    category: feedbackCategorySchema,
    pageUrl: z.string().trim().min(1).max(2000),
    message: z.string().trim().min(3).max(4000),
    photos: z
      .array(z.string().startsWith('data:image/jpeg;base64,'))
      .max(FEEDBACK_MAX_PHOTOS)
      .default([]),
  })
  .strict()

// Base64 grows a file by a third; the rest of the body is a few kilobytes.
export const FEEDBACK_MAX_BODY_BYTES = Math.ceil((MAX_ASSET_BYTES * FEEDBACK_MAX_PHOTOS * 4) / 3) + 16384

export function feedbackPhotoBytes(dataUrl: string) {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (!jpeg || bytes.length > MAX_ASSET_BYTES)
    throw createError({
      statusCode: 400,
      message: 'server.FEEDBACK_INVALID',
      data: { code: 'FEEDBACK_INVALID' },
    })
  return bytes
}

export function feedbackPhotoPath(organizationId: string, feedbackKey: string, index: number) {
  return `feedback/${organizationId}/${feedbackKey}_${index}.jpg`
}

const failures: Record<string, { statusCode: number; message: string }> = {
  FEEDBACK_RATE_LIMITED: { statusCode: 429, message: 'server.RATE_LIMIT_REACHED' },
  FEEDBACK_INVALID: { statusCode: 400, message: 'server.FEEDBACK_INVALID' },
  FEEDBACK_NOT_FOUND: { statusCode: 404, message: 'server.FEEDBACK_NOT_FOUND' },
}

export function clientFeedbackFailure(message: string | undefined) {
  const match = message ? Object.keys(failures).find((code) => message.includes(code)) : undefined
  return match ? { ...failures[match]!, code: match } : null
}

function throwFailure(message: string | undefined) {
  const failure = clientFeedbackFailure(message)
  if (failure)
    throw createError({
      statusCode: failure.statusCode,
      message: failure.message,
      data: { code: failure.code },
    })
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await adminServiceClient().rpc(name, args)
  if (error) {
    throwFailure(error.message)
    console.error('Admin feedback call failed.', { name, code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.FEEDBACK_LOAD_FAILED' })
  }
  return data as T
}

export function adminClientFeedback() {
  return rpc<{ feedback: unknown[] }>('admin_client_feedback', {})
}

export function adminClientFeedbackPhoto(feedbackId: string, index: number) {
  return rpc<string | null>('admin_client_feedback_photo', {
    p_feedback_id: feedbackId,
    p_index: index,
  })
}

export async function deleteClientFeedback(feedbackId: string, actor: { id: string; email: string }) {
  const result = await rpc<{ photo_paths: string[] }>('admin_delete_client_feedback', {
    p_feedback_id: feedbackId,
    p_actor_id: actor.id,
    p_actor_email: actor.email,
  })
  // The row is already gone; a photo that fails to delete is logged rather than
  // bringing the feedback back.
  await Promise.all(
    result.photo_paths.map((path) =>
      removeAsset(path).catch((error) =>
        console.error('Feedback photo cleanup failed.', { path, error: String(error) }),
      ),
    ),
  )
  return { id: feedbackId }
}

export { throwFailure as throwClientFeedbackFailure }
