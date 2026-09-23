import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const contentEditor = readFileSync(new URL('../../app/components/ContentEditor.vue', import.meta.url), 'utf8')

describe('ContentEditor', () => {
  it('keeps gallery assets out of an existing post editor and constrains new-post thumbnails', () => {
    expect(contentEditor).toContain('v-if="!props.id" class="asset-picker"')
    expect(contentEditor).toContain('class="size-16 p-0"')
    expect(contentEditor).toContain('class="size-full rounded"')
  })
})
