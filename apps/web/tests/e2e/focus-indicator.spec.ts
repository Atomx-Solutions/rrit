import { expect, test } from '@playwright/test'

test('a focused text input uses a compact accessible focus halo', async ({ page }) => {
  await page.goto('/login')

  const email = page.getByRole('textbox', { name: /email/i })
  await email.click()

  const focus = await email.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
    }
  })

  expect(focus.outlineStyle).toBe('none')
  expect(focus.boxShadow).not.toBe('none')
})
