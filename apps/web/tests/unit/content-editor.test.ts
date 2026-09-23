import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const editor = readFileSync(new URL('../../app/components/ContentEditor.vue', import.meta.url), 'utf8')

describe('ContentEditor', () => {
  it('localizes the known Meta publication confirmation stored on existing posts', () => {
    expect(editor).toContain("localizedPolicyReason(post.value?.policyReason || '', t)")
  })
})
