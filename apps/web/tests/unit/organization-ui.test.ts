import { describe, expect, it } from 'vitest'
import { organizationFormMessage, slugFromOrganizationName } from '../../app/utils/organization-ui'

describe('organization UI model', () => {
  it('creates a safe slug suggestion from an organization name', () => {
    expect(slugFromOrganizationName('  Café & Studio  ')).toBe('cafe-studio')
  })

  it('requires a valid organization name and slug before submit', () => {
    expect(organizationFormMessage({ name: '', slug: '' })).toBeTruthy()
    expect(organizationFormMessage({ name: 'Studio', slug: 'studio' })).toBeNull()
  })
})
