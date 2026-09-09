import { expect, test, type Page } from '@playwright/test'

const capabilities = {
  authentication: true,
  registration: true,
  passwordRecovery: true,
  emailDelivery: true,
  emailVerificationRequired: false,
  trialHours: 72,
  socialImport: false,
  publishing: false,
  ai: false,
  billing: false,
}

function plan(name: string, price: number, posts: number) {
  return {
    name,
    version: 1,
    monthlyCents: price * 100,
    price,
    currency: 'EUR',
    description: 'Plan vetëm për verifikim automatik.',
    annualDiscount: 0,
    displayFeatures: [`${posts} postime në muaj`],
    features: [`${posts} postime në muaj`],
    entitlements: ['posts'],
    limits: {
      posts_per_month: posts,
      ai_requests_per_day: 0,
      media_storage_bytes: 1024,
      social_accounts: 2,
      members: 1,
    },
    purchasable: false,
  }
}
// Deliberately unsorted: recommendation and unit value must follow the catalog.
const catalog = [
  plan('Vëllim test', 66, 60),
  plan('Fillim test', 18, 12),
  plan('Përditë test', 39, 30),
]

async function enterLanding(page: Page) {
  await page.goto('/login')
  await page.waitForFunction(() => '__vue_app__' in document.querySelector('#__nuxt')!)
  await page.getByRole('link', { name: '← Kthehu te Rrit' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Postime që/)
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/plans', (route) => route.fulfill({ json: catalog }))
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: capabilities }))
})
test('landing presents three real photographs and a working registration action', async ({
  page,
}) => {
  const mutations: string[] = []
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(request.url())
  })
  await enterLanding(page)
  await expect(page.locator('.landing-design-post')).toHaveCount(3)
  await expect(
    page.locator('.landing input, .landing select, .landing-workflow, .landing-start-card'),
  ).toHaveCount(0)
  for (const photo of await page.locator('.landing-post-deck img').all()) {
    await expect
      .poll(() =>
        photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true)
  }
  await page.locator('.landing-hero .landing-primary-button').click()
  await expect(page).toHaveURL(/\/signup$/)
  expect(mutations).toEqual([])
})
test('landing compares monthly and annual plan prices without hardcoded allowances', async ({
  page,
}) => {
  await page.route('**/api/plans', (route) =>
    route.fulfill({ json: catalog.map((p) => ({ ...p, annualDiscount: 20 })) }),
  )
  await enterLanding(page)
  const volume = page.locator('[data-plan="Vëllim test"]')
  const daily = page.locator('[data-plan="Përditë test"]')
  await expect(volume).toContainText('60 postime')
  await expect(volume.locator('.landing-plan-unit strong')).toHaveText(/1,1\s*€/)
  await expect(volume).toContainText('Më lirë për postim')
  await expect(daily).toContainText('Rekomandimi ynë')
  await expect(daily.locator('.landing-plan-unit strong')).toHaveText(/1,3\s*€/)
  await page.getByRole('tab', { name: /Vjetor/ }).click()
  await expect(volume.locator('[data-slot="price"]')).toHaveText(/52,8\s*€/)
  await expect(volume.locator('.landing-plan-unit strong')).toHaveText(/0,88\s*€/)
  await expect(volume.locator('[data-slot="terms"]')).toHaveText(/633,6\s*€ në vit/)
})
test('landing does not claim that an expensive volume plan has the lowest unit price', async ({
  page,
}) => {
  await page.route('**/api/plans', (route) =>
    route.fulfill({
      json: [
        plan('Fillim test', 18, 12),
        plan('Përditë test', 39, 30),
        plan('Vëllim test', 99, 60),
      ],
    }),
  )
  await enterLanding(page)
  const volume = page.locator('[data-plan="Vëllim test"]')
  await expect(volume).not.toContainText('Më lirë për postim')
  await expect(volume).not.toContainText('% më pak')
  await expect(volume.locator('.landing-plan-unit strong')).toHaveText(/1,65\s*€/)
})

test('landing and the pricing page share the live catalog and direct plan actions', async ({
  page,
}) => {
  await page.route('**/api/plans', (route) =>
    route.fulfill({ json: catalog.map((p) => ({ ...p, annualDiscount: 20 })) }),
  )
  await enterLanding(page)
  await expect(page.locator('.landing-hero .landing-primary-button')).toHaveText(
    'Provoje 3 ditë falas',
  )
  const catalogText = await page.locator('.landing-plan-grid').textContent()
  await page.getByRole('link', { name: 'Krahaso planet në detaje' }).click()
  await expect(page).toHaveURL(/\/pricing$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sa postime të duhen?')
  await expect(page.locator('.landing-plan-grid')).toHaveText(catalogText!)
  await expect(page.getByRole('link', { name: 'Krahaso planet në detaje' })).toHaveCount(0)
  const volume = page.locator('[data-plan="Vëllim test"]')
  await page.getByRole('tab', { name: /Vjetor/ }).click()
  await expect(volume.locator('[data-slot="price"]')).toHaveText(/52,8\s*€/)
  await expect(volume.locator('.landing-plan-unit strong')).toHaveText(/0,88\s*€/)
  await expect(volume.locator('[data-slot="terms"]')).toHaveText(/633,6\s*€ në vit/)
  await page.getByRole('tab', { name: 'Mujor', exact: true }).click()
  await expect(volume.locator('[data-slot="price"]')).toHaveText(/66\s*€/)
  await volume.getByRole('link', { name: 'Provoje 3 ditë falas' }).click()
  await expect(page).toHaveURL(/\/signup$/)
})

test('landing header switches light and dark appearance and preserves the choice', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await enterLanding(page)
  const theme = page.getByRole('button', { name: 'Ndrysho pamjen e faqes' })
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(theme).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await theme.click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('link', { name: 'Krahaso planet në detaje' }).click()
  await expect(page).toHaveURL(/\/pricing$/)
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await page.waitForFunction(() => '__vue_app__' in document.querySelector('#__nuxt')!)
  await expect(page.locator('html')).toHaveClass(/dark/)
  // The root exists before async public-layout hydration has attached this button's listener.
  await expect
    .poll(() =>
      theme.evaluate(
        (element) =>
          '__vueParentComponent' in element &&
          (element.__vueParentComponent as { isMounted: boolean }).isMounted,
      ),
    )
    .toBe(true)
  await theme.click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})
test('landing recovers from failed and empty catalog states', async ({ page }) => {
  let available = false
  await page.route('**/api/plans', (route) =>
    available
      ? route.fulfill({ json: [] })
      : route.fulfill({ status: 503, json: { message: 'Unavailable' } }),
  )
  await enterLanding(page)
  await expect(page.getByText('Çmimet nuk u ngarkuan.')).toBeVisible()
  await expect(page.locator('.landing-plan-card')).toHaveCount(0)
  available = true
  await page.getByRole('button', { name: 'Provo sërish', exact: true }).click()
  await expect(page.getByText('Planet do të shfaqen së shpejti.')).toBeVisible()
})
test('landing registration and publishing copy follow capabilities', async ({ page }) => {
  let ready = false
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({
      json: { ...capabilities, registration: ready, trialHours: ready ? 48 : null },
    }),
  )
  await enterLanding(page)
  await expect(page.getByRole('link', { name: /Provoje.*falas/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'A publikohen postimet vetë?' }).click()
  await expect(
    page.getByText('Publikimi automatik ende nuk është aktiv.', { exact: false }),
  ).toBeVisible()
  ready = true
  await page.getByRole('button', { name: 'Kontrollo regjistrimin' }).click()
  await expect(page.locator('.landing-hero .landing-primary-button')).toHaveText(
    'Provoje 2 ditë falas',
  )
})
test('landing motion can be paused and respects reduced motion across viewports', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await enterLanding(page)
  await page.locator('.landing-showcase').scrollIntoViewIfNeeded()
  const card = page.locator('.landing-post-food')
  await expect(card).toHaveCSS('animation-play-state', 'running')
  await page.getByRole('button', { name: 'Ndalo animacionin' }).click()
  await expect(card).toHaveCSS('animation-play-state', 'paused')
  await page.getByRole('button', { name: 'Vazhdo animacionin' }).click()
  await expect(card).toHaveCSS('animation-play-state', 'running')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(card).toHaveCSS('animation-name', 'none')
  await expect(page.getByRole('button', { name: 'Ndalo animacionin' })).toHaveCount(0)
  for (const width of [320, 390, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `overflow at ${width}`,
    ).toBe(true)
    expect(await page.locator('h1').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await expect(page.locator('.landing')).toHaveCSS('background-color', 'rgb(18, 33, 27)')
  await expect(page.locator('.marketing-footer')).toHaveCSS('background-color', 'rgb(11, 25, 20)')
})
test('landing SSR hydrates without mismatches and keeps every plan readable', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (/hydration.*mismatch/i.test(message.text())) errors.push(message.text())
  })
  await page.goto('/')
  await page.waitForFunction(() => '__vue_app__' in document.querySelector('#__nuxt')!)
  await expect(page.locator('.landing-design-post')).toHaveCount(3)
  for (const card of await page.locator('.landing-plan-card').all()) {
    expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  expect(errors).toEqual([])
})

test('landing feature scenes pause independently and stop outside the viewport', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await enterLanding(page)
  for (const [selector, label] of [
    ['.landing-studio-scene', 'pamjen e studios'],
    ['.landing-tennis-scene', 'pamjen e tenisit'],
  ]) {
    const scene = page.locator(selector!)
    await scene.scrollIntoViewIfNeeded()
    const object = scene.locator('.landing-depth-item').first()
    await expect(object).toHaveCSS('animation-play-state', 'running')
    await scene.getByRole('button', { name: `Pauzo ${label}` }).click()
    await expect(object).toHaveCSS('animation-play-state', 'paused')
    await scene.getByRole('button', { name: `Vazhdo ${label}` }).click()
    await expect(object).toHaveCSS('animation-play-state', 'running')
    for (const photo of await scene.locator('img').all()) {
      await expect
        .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
        .toBe(true)
    }
  }
  await page.locator('.landing-final').scrollIntoViewIfNeeded()
  for (const object of await page.locator('.landing-depth-item').all()) {
    await expect(object).toHaveCSS('animation-play-state', 'paused')
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const object of await page.locator('.landing-depth-item').all()) {
    await expect(object).toHaveCSS('animation-name', 'none')
  }
})

test('landing highlights the recommended package and keeps a readable mobile order', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await enterLanding(page)
  const featured = page.locator('.landing-plan-featured')
  await expect(featured).toHaveCSS('border-top-width', '1px')
  expect(await featured.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    await page
      .locator('.landing-plan-card:not(.landing-plan-featured)')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  )
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width < 768) {
      for (const row of await page.locator('.landing-feature-row').all()) {
        const copy = await row.locator('.landing-feature-copy').boundingBox()
        const scene = await row.locator('.landing-feature-scene').boundingBox()
        expect(scene!.y).toBeGreaterThan(copy!.y + copy!.height)
      }
    }
  }
})

test('landing motion preserves readable content and resets pointer tilt when paused', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await enterLanding(page)
  const scene = page.locator('.landing-tennis-scene')
  await scene.scrollIntoViewIfNeeded()
  await expect(scene.locator('.landing-tennis-ground')).toHaveCSS('animation-play-state', 'running')
  const content = scene.locator('.landing-scene-content')
  if (await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)) {
    const bounds = await scene.locator('.landing-scene-stage').boundingBox()
    await page.mouse.move(bounds!.x + bounds!.width * 0.8, bounds!.y + bounds!.height * 0.3)
    await expect
      .poll(() => content.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--scene-y')))
      .not.toBe('')
    await scene.getByRole('button', { name: 'Pauzo pamjen e tenisit' }).click()
    await expect
      .poll(() => content.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--scene-y')))
      .toBe('')
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('.landing-faq-layout').scrollIntoViewIfNeeded()
  await expect(page.locator('.landing-faq-layout')).toHaveCSS('opacity', '1')
  await expect(content).toHaveCSS('transform', 'none')
  await expect(scene.locator('.landing-tennis-ground .landing-tennis-copy')).toHaveCSS(
    'opacity',
    '1',
  )
  await expect(scene.locator('.landing-tennis-ground .landing-tennis-signature')).toHaveCSS(
    'opacity',
    '1',
  )
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (animation) => animation.id === 'rrit-reveal' && animation.playState === 'running',
          ).length,
    ),
  ).toBe(0)
  for (const object of await scene.locator('.landing-depth-item').all()) {
    await expect(object).toHaveCSS('animation-name', 'none')
  }
})

test('landing tennis uses a real borderless photograph and a faster illustrative sequence', async ({
  page,
}) => {
  const mutations: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      mutations.push(request.url())
  })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await enterLanding(page)
  const scene = page.locator('.landing-tennis-scene')
  await scene.scrollIntoViewIfNeeded()
  await expect(scene).toHaveClass(/is-animated/)
  const photo = scene.locator('.landing-tennis-ground .landing-tennis-photo')
  const preview = scene.locator('.landing-tennis-instagram')
  await expect(photo).toHaveAttribute('src', '/images/tennis-ball-court.jpg')
  await expect
    .poll(() =>
      photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1000),
    )
    .toBe(true)
  await expect(
    scene.locator(
      'svg, .landing-tennis-snapshot, .landing-tennis-backdrop, .landing-tennis-profile',
    ),
  ).toHaveCount(0)
  await expect(scene.locator('.landing-tennis-ground')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
  await expect(scene.locator('.landing-tennis-ground')).toHaveCSS('border-top-width', '0px')
  await expect(scene.locator('.landing-tennis-ground')).toHaveCSS('box-shadow', 'none')
  await expect(photo).not.toHaveCSS('mask-image', 'none')
  await expect(photo).toHaveCSS('animation-duration', '10s')
  const seek = async (time: number) => {
    await scene.evaluate(async (element, currentTime) => {
      element.getAnimations({ subtree: true }).forEach((animation) => {
        animation.pause()
        animation.currentTime = currentTime
      })
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }, time)
  }
  await seek(0)
  await expect(preview).toHaveCSS('opacity', '0')
  await expect(photo).toHaveCSS('opacity', '0')
  await seek(800)
  await expect(photo).toHaveCSS('opacity', '1')
  await expect(scene.locator('.landing-tennis-ground .landing-tennis-copy')).toHaveCSS(
    'opacity',
    '0',
  )
  await seek(2500)
  await expect(scene.locator('.landing-tennis-ground .landing-tennis-copy')).toHaveCSS(
    'opacity',
    '1',
  )
  await expect(scene.locator('.landing-tennis-ground .landing-tennis-signature')).toHaveCSS(
    'opacity',
    '1',
  )
  await seek(4200)
  await expect(preview).toHaveCSS('opacity', '0')
  await expect(scene.locator('.landing-tennis-ground')).toHaveCSS('opacity', '1')
  await expect(scene.locator('.landing-tennis-publish')).toHaveCSS('opacity', '1')
  await seek(5600)
  await expect(scene.locator('.landing-tennis-ground')).toHaveCSS('opacity', '0')
  await expect(preview).toHaveCSS('opacity', '1')
  await expect(preview).toHaveAttribute('aria-hidden', 'true')
  await expect(preview).toContainText('Instagram · postimi yt')
  await expect(preview.locator('img')).toHaveAttribute(
    'src',
    (await photo.getAttribute('src')) as string,
  )
  await expect(preview.locator('img')).toHaveCSS('mask-image', 'none')
  await expect(preview.locator('.landing-tennis-copy')).toHaveCSS('opacity', '1')
  await expect(preview.locator('button, a')).toHaveCount(0)
  await seek(6900)
  await expect(preview).toHaveCSS('opacity', '1')
  await expect(scene.locator('.landing-tennis-published')).toHaveCSS('opacity', '1')
  await expect(scene.locator('.landing-tennis-publish')).toHaveCSS('opacity', '0')
  await expect(photo).toHaveCSS('opacity', '1')
  await seek(7400)
  await expect(scene.locator('.landing-tennis-ground')).toHaveCSS('opacity', '1')
  await expect(scene.locator('.landing-tennis-published')).toHaveCSS('opacity', '0')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(photo).toHaveCSS('animation-name', 'none')
  await expect(photo).toHaveCSS('opacity', '1')
  await expect(scene.locator('.landing-tennis-ground .landing-tennis-copy')).toHaveCSS(
    'opacity',
    '1',
  )
  await expect(scene.locator('.landing-tennis-ground .landing-tennis-signature')).toHaveCSS(
    'opacity',
    '1',
  )
  await expect(scene.locator('.landing-tennis-published')).toHaveCSS('opacity', '0')
  expect(mutations).toEqual([])
})
