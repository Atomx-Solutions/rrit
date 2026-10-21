import { afterEach, describe, expect, it, vi } from 'vitest'
import { TikTokPhotoNotPermitted, uploadTikTokPhotoDraft } from '../../server/utils/tiktok'
import { postSchema } from '../../shared/schemas/workspace'

afterEach(() => vi.unstubAllGlobals())

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const input = {
  photoUrl: 'https://framic.example/api/publishing-media/22222222-2222-4222-8222-222222222222?expires=1&signature=x',
  title: 'Makina gati',
  description: 'Rezervo sot.',
}

describe('TikTok photo drafts', () => {
  it('sends the photo to the inbox as a draft pulled from our signed URL', async () => {
    const fetch = answer(200, { data: { publish_id: 'p_1' }, error: { code: 'ok' } })
    await expect(uploadTikTokPhotoDraft('token', input)).resolves.toEqual({ publishId: 'p_1' })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://open.tiktokapis.com/v2/post/publish/content/init/')
    expect(JSON.parse(init.body as string)).toEqual({
      media_type: 'PHOTO',
      post_mode: 'MEDIA_UPLOAD',
      post_info: { title: 'Makina gati', description: 'Rezervo sot.' },
      source_info: { source: 'PULL_FROM_URL', photo_images: [input.photoUrl], photo_cover_index: 0 },
    })
  })

  it('keeps the title inside the 90 characters TikTok allows', async () => {
    const fetch = answer(200, { data: { publish_id: 'p_2' } })
    await uploadTikTokPhotoDraft('token', { ...input, title: 'ë'.repeat(120) })
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(Array.from(body.post_info.title)).toHaveLength(90)
  })

  it.each(['url_ownership_unverified', 'scope_not_authorized'])(
    'reports %s as a permission the app lacks, not as a failed post',
    async (code) => {
      answer(403, { error: { code, message: 'denied' } })
      const sent = uploadTikTokPhotoDraft('token', input)
      await expect(sent).rejects.toBeInstanceOf(TikTokPhotoNotPermitted)
      await expect(uploadTikTokPhotoDraft('token', input)).rejects.toMatchObject({ code })
    },
  )

  it('treats any other rejection as a real failure', async () => {
    answer(400, { error: { code: 'invalid_param', message: 'bad' } })
    await expect(uploadTikTokPhotoDraft('token', input)).rejects.not.toBeInstanceOf(TikTokPhotoNotPermitted)
  })

  it('stores how a post was handed to TikTok, and reads posts without it', () => {
    const base = {
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Postim',
      caption: 'Tekst',
      status: 'approved',
      channel: 'TikTok',
      format: 'static',
      image: '/api/media/22222222-2222-4222-8222-222222222222',
      pillar: 'brand',
      scheduledAt: null,
      version: 1,
      history: [],
      policy: 'pass',
      policyReason: '',
    }
    expect(postSchema.parse(base).tiktokDelivery).toBeUndefined()
    expect(
      postSchema.parse({ ...base, tiktokDelivery: { mode: 'manual', reason: 'url_ownership_unverified', at: '2026-10-21T10:00:00.000Z' } })
        .tiktokDelivery?.mode,
    ).toBe('manual')
  })
})
