import { describe, expect, it } from 'vitest'
import { dashboardToolbarUi } from '../../app/utils/dashboard-header'

describe('dashboard toolbar borders', () => {
  it('removes the lower divider only when a page opts out of it', () => {
    expect(dashboardToolbarUi(false).root).toContain('border-b-0')
  })

  it('keeps the lower divider for pages that use the standard toolbar', () => {
    expect(dashboardToolbarUi(true).root).not.toContain('border-b-0')
  })
})
