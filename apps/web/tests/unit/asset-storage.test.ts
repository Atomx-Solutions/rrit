import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assetBucket,
  assetStorageFolder,
  assetStoragePath,
  downloadAsset,
  MAX_ASSET_BYTES,
} from '../../server/utils/asset-storage'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('asset storage paths', () => {
  it('uses the configured bucket and keeps the business folder stable', () => {
    expect(assetBucket()).toBe('assets')
    expect(assetStorageFolder('uji-rugova', '34')).toBe('uji-rugova-34')
  })

  it('preserves the original filename stem and adds a UTC upload timestamp', () => {
    const path = assetStoragePath(
      'uji-rugova-34',
      'foto vera.jpg',
      new Date('2026-09-09T14:23:37.481Z'),
    )
    expect(path).toBe('uji-rugova-34/foto-vera_20260909T142337481Z.jpg')
  })

  it('removes path traversal and unsafe filename characters', () => {
    const path = assetStoragePath(
      'uji-rugova-34',
      '../verë/foto final!.jpeg',
      new Date('2026-09-09T14:23:37.481Z'),
    )
    expect(path).toBe('uji-rugova-34/foto-final_20260909T142337481Z.jpg')
  })

  it('aborts a Storage download after the configured timeout', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://storage.example.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-fixture')
    vi.stubEnv('ASSET_STORAGE_DOWNLOAD_TIMEOUT_MS', '1000')
    vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
      Object.assign(new Error(input.message), input),
    )
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadAsset('uji-rugova-34/slow.jpg')).rejects.toMatchObject({ statusCode: 504 })
    expect(fetchMock).toHaveBeenCalled()
  })

  it('rejects a Storage response above the maximum source-photo size', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://storage.example.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-fixture')
    vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
      Object.assign(new Error(input.message), input),
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array(MAX_ASSET_BYTES + 1), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadAsset('uji-rugova-34/too-large.jpg')).rejects.toMatchObject({
      statusCode: 413,
    })
  })
})
