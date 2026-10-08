import { describe, expect, it } from 'vitest'
import { canReuseWorkspaceRedirect } from '../../app/utils/workspace-redirect'

describe('workspace redirect reuse', () => {
  const workspace = { id: 'org-1', slug: 'brand-1' }
  const overview = '/app/org-1/brand-1/overview'

  it('reuses the workspace only for the immediate matching overview redirect', () => {
    expect(canReuseWorkspaceRedirect(overview, overview, true, workspace)).toBe(true)
    expect(canReuseWorkspaceRedirect(null, overview, true, workspace)).toBe(false)
    expect(canReuseWorkspaceRedirect(overview, overview, false, workspace)).toBe(false)
    expect(canReuseWorkspaceRedirect(overview, overview, true, null)).toBe(false)
  })

  it('does not reuse a workspace for another brand or destination', () => {
    expect(canReuseWorkspaceRedirect(overview, '/app/org-1/other/overview', true, workspace)).toBe(false)
    expect(canReuseWorkspaceRedirect(overview, '/app/org-1/brand-1/billing', true, workspace)).toBe(false)
    expect(canReuseWorkspaceRedirect('/app/org-1/other/overview', '/app/org-1/other/overview', true, workspace)).toBe(false)
  })
})
