import { describe, expect, it } from 'vitest'
import { assetBucket, assetStorageFolder, assetStoragePath } from '../../server/utils/asset-storage'

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
})
