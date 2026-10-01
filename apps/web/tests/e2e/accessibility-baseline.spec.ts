import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { signUp } from './helpers/auth'

const publicRoutes = ['/', '/login', '/signup'] as const

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const blocking = result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target),
    }))

  expect(blocking).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
}

async function expectReadableInDarkMode(page: Page) {
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await expectAccessible(page)
  await expectVisibleKeyboardFocus(page)
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

async function expectVisibleKeyboardFocus(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })

  let focus: { tag: string; outlineWidth: number; boxShadow: string } | null = null
  for (let attempt = 0; attempt < 12 && !focus; attempt++) {
    await page.keyboard.press('Tab')
    focus = await page.evaluate(() => {
      const element = document.activeElement
      if (!(element instanceof HTMLElement) || element === document.body) return null
      const style = getComputedStyle(element)
      const rectangle = element.getBoundingClientRect()
      const isOnScreen =
        rectangle.width > 0 &&
        rectangle.height > 0 &&
        rectangle.bottom > 0 &&
        rectangle.right > 0 &&
        rectangle.top < window.innerHeight &&
        rectangle.left < window.innerWidth
      if (!isOnScreen) return null

      return {
        tag: element.tagName,
        outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
        boxShadow: style.boxShadow,
      }
    })
  }

  expect(focus, 'Tab should reach an on-screen interactive control').not.toBeNull()
  expect(
    (focus?.outlineWidth ?? 0) >= 2 || (focus?.boxShadow && focus.boxShadow !== 'none'),
    `Expected a visible focus indicator on ${focus?.tag ?? 'the focused element'}`,
  ).toBeTruthy()
}

function parseMotionTime(value: string) {
  return Math.max(
    ...value.split(',').map((item) => {
      const duration = Number.parseFloat(item)
      return item.trim().endsWith('ms') ? duration : duration * 1000
    }),
  )
}

async function expectReducedMotion(page: Page) {
  const longestDuration = await page.evaluate(() => {
    const milliseconds = (value: string) =>
      Math.max(
        ...value.split(',').map((item) => {
          const duration = Number.parseFloat(item)
          return item.trim().endsWith('ms') ? duration : duration * 1000
        }),
      )

    return Math.max(
      ...Array.from(document.querySelectorAll('*')).flatMap((element) => {
        const style = getComputedStyle(element)
        return [milliseconds(style.animationDuration), milliseconds(style.transitionDuration)]
      }),
    )
  })

  expect(longestDuration).toBeLessThanOrEqual(parseMotionTime('0.01ms'))
}

async function createBusiness(page: Page, origin: string) {
  await signUp(page, 'Kontrolli i aksesueshmërisë')
  const request = page.request
  /* Legacy request flow kept as a reference while the test uses the Supabase UI flow.
  const signup = await request.post('/api/supabase-auth-placeholder', {
    headers: { Origin: origin },
    data: {
      name: 'Kontrolli i aksesueshmërisë',
      email: `accessibility-${randomUUID()}@example.test`,
      password: `Test-only-${randomUUID()}`,
      callbackURL: '/onboarding',
    },
  })
  expect(signup.status()).toBe(200) */

  const response = await request.post('/api/business', {
    headers: { Origin: origin },
    data: {
      name: 'Studio Aksesueshme',
      city: 'Prishtinë',
      industry: 'Shërbime',
      description: 'Shërbime profesionale për klientët në Kosovë.',
      voice: 'E qartë dhe miqësore',
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { id: string; slug: string }
}

test('landing and authentication pages meet the light and dark accessibility baseline', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })

  for (const route of publicRoutes) {
    await page.goto(route)
    await expect(page.locator('main')).toBeVisible()
    await expectAccessible(page)
    await expectVisibleKeyboardFocus(page)
    await expectReadableInDarkMode(page)
  }

  await page.goto('/')
  await expectReducedMotion(page)
})

test('the authenticated dashboard shell meets the light and dark accessibility baseline', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin
  const business = await createBusiness(page, origin)

  await page.goto(`/app/${business.id}/${business.slug}/overview`)
  await expect(page.locator('main')).toBeVisible()
  await expectAccessible(page)
  await expectVisibleKeyboardFocus(page)
  await expectReadableInDarkMode(page)
})
