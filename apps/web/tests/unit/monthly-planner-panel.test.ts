import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const panel = readFileSync(new URL('../../app/components/MonthlyPlannerPanel.vue', import.meta.url), 'utf8')

describe('MonthlyPlannerPanel', () => {
  it('shows the same vertical photo gallery for both selection modes', () => {
    expect(panel).toContain('v-if="originalPhotos.length"')
    expect(panel).toContain(':disabled="photoMode === \'auto\'"')
    expect(panel).toContain('disabled:cursor-default disabled:opacity-100')
    expect(panel).toContain('fit="cover"')
    expect(panel).toContain('i-lucide-image')
  })

  it('shows selection controls only while the user chooses photos', () => {
    expect(panel).toContain("photoMode === 'selected' && selectedPhotoIds.includes(asset.id)")
  })

  it('keeps photo cards visually consistent across both modes', () => {
    expect(panel).not.toContain('group-disabled:grayscale')
    expect(panel).not.toContain("photoMode === 'auto' ? 'i-lucide-eye' : 'i-lucide-mouse-pointer-click'")
  })

  it('uses the entire area above the filename for the photo', () => {
    expect(panel).toContain('flex-1 min-h-0 w-full')
    expect(panel).not.toContain('i-lucide-images')
  })

  it('labels the automatic gallery as a non-interactive preview', () => {
    expect(panel).toContain("t('monthly.aiPhotoPreview')")
    expect(panel).toContain("t('monthly.aiPhotoPreviewDescription')")
    expect(panel).toContain("i-lucide-eye")
  })
})
