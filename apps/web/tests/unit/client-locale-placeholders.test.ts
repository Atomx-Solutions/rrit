import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const folder = new URL('../../app/locales/client/', import.meta.url)
const locales = readdirSync(folder).filter((file) => file.endsWith('.json'))

describe('client locale placeholders', () => {
  // The app fills in {{name}}; a single-brace {name} reaches the screen as is.
  it.each(locales)('writes every placeholder with double braces in %s', (file) => {
    const messages = JSON.parse(readFileSync(new URL(file, folder), 'utf8')) as Record<string, unknown>
    const single = Object.entries(messages)
      .filter(([, text]) => typeof text === 'string' && /(?<!\{)\{[a-zA-Z]+\}(?!\})/.test(text))
      .map(([key]) => key)
    expect(single).toEqual([])
  })
})
