import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dashboardToolbarUi } from '../../app/utils/dashboard-header'

const overviewPage = readFileSync(
  new URL('../../app/pages/app/[org]/[brand]/overview.vue', import.meta.url),
  'utf8',
)
const monthlyPlannerPage = readFileSync(
  new URL('../../app/pages/app/[org]/[brand]/monthly-planner.vue', import.meta.url),
  'utf8',
)
const contentPage = readFileSync(
  new URL('../../app/pages/app/[org]/[brand]/content/index.vue', import.meta.url),
  'utf8',
)
const calendarPage = readFileSync(
  new URL('../../app/pages/app/[org]/[brand]/calendar.vue', import.meta.url),
  'utf8',
)
const socialPostsPage = readFileSync(
  new URL('../../app/pages/app/[org]/[brand]/social-posts.vue', import.meta.url),
  'utf8',
)
const billingPage = readFileSync(
  new URL('../../app/pages/app/[org]/[brand]/billing.vue', import.meta.url),
  'utf8',
)
const settingsPage = readFileSync(
  new URL('../../app/pages/app/[org]/[brand]/settings.vue', import.meta.url),
  'utf8',
)

describe('dashboard toolbar borders', () => {
  it('removes the lower divider only when a page opts out of it', () => {
    expect(dashboardToolbarUi(false).root).toContain('border-b-0')
  })

  it('keeps the lower divider for pages that use the standard toolbar', () => {
    expect(dashboardToolbarUi(true).root).not.toContain('border-b-0')
  })

  it('uses the gallery header treatment on the overview page', () => {
    expect(overviewPage).toMatch(/<DashboardPage[\s\S]*?:toolbar-border="false"/)
  })

  it('uses the gallery header treatment on the monthly planner page', () => {
    expect(monthlyPlannerPage).toMatch(/<DashboardPage[\s\S]*?:toolbar-border="false"/)
  })

  it('uses the gallery header treatment on the content page', () => {
    expect(contentPage).toMatch(/<DashboardPage[\s\S]*?:toolbar-border="false"/)
  })

  it('uses the gallery header treatment on the calendar page', () => {
    expect(calendarPage).toMatch(/<DashboardPage[\s\S]*?:toolbar-border="false"/)
  })

  it('uses the gallery header treatment on the social posts page', () => {
    expect(socialPostsPage).toMatch(/<DashboardPage[\s\S]*?:toolbar-border="false"/)
  })

  it('uses the gallery header treatment on the billing page', () => {
    expect(billingPage).toMatch(/<DashboardPage[\s\S]*?:toolbar-border="false"/)
  })

  it('uses the gallery header treatment on the settings page', () => {
    expect(settingsPage).toMatch(/<DashboardPage[\s\S]*?:toolbar-border="false"/)
  })

  it('removes the inactive tab baseline from the settings toolbar', () => {
    expect(settingsPage).toContain("list: 'flex-wrap gap-1 border-b-0'")
  })

  it('uses a compact mobile title for social posts', () => {
    expect(socialPostsPage).toContain(":mobile-title=\"t('nav.posts')\"")
  })
})
