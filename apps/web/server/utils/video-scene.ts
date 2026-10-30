import sharp from 'sharp'
import type { PublishingChannel } from '../../shared/schemas/channel-format'
import { requestOutpaint } from './photo-fit'
import { sceneDressingRule } from './scene-dressing'

/**
 * The photograph a video is shot from, dressed the way its still post is: the
 * same scene with the props that belong to this business on its empty
 * surfaces, and no type, so the motion model moves through the scene the post
 * shows rather than a bare one. A photograph that cannot be dressed is shot
 * as it is; the video never fails for it.
 */
export async function dressVideoScene(input: {
  photograph: Buffer
  channel: PublishingChannel
  brand: { name: string; industry?: string; audience?: string }
  post: { title?: string; caption?: string }
}, dependencies: { paint?: typeof requestOutpaint } = {}) {
  const paint = dependencies.paint || requestOutpaint
  const prompt = [
    'Edit this real photograph of a business into the same photograph, ready to be the opening frame of its short video.',
    `Business: ${input.brand.name}.${input.brand.industry ? ` Industry: ${input.brand.industry}.` : ''}${input.brand.audience ? ` Audience: ${input.brand.audience}.` : ''}`,
    `Post: ${[input.post.title, input.post.caption].filter(Boolean).join(' — ').slice(0, 600)}`,
    sceneDressingRule,
    'Keep the exact framing, camera position, perspective, light and colour of the photograph. Add no letters, words, numbers, logos, graphics, frames or watermarks anywhere.',
  ].join('\n')
  const { width, height } = await sharp(input.photograph).metadata()
  try {
    const painted = await paint(input.photograph, prompt, input.channel)
    const bytes = await sharp(painted.bytes)
      .resize(width, height, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 92 })
      .toBuffer()
    return { bytes, costUsd: painted.costUsd ?? 0, dressed: true }
  } catch (error) {
    console.warn('The video scene could not be dressed; the photograph is shot as it is', { error: error instanceof Error ? error.message : 'unknown' })
    return { bytes: input.photograph, costUsd: 0, dressed: false }
  }
}
