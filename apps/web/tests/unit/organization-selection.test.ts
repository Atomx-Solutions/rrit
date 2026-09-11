import { describe, expect, it } from 'vitest'
import {
  isAllowedOrganizationId,
  selectValidOrganization,
} from '../../app/utils/organization-selection'

const organizations = [
  { id: 'org-a', name: 'Organization A' },
  { id: 'org-b', name: 'Organization B' },
]

describe('organization selection safety', () => {
  it('restores a persisted organization only when it is API-visible', () => {
    expect(selectValidOrganization(organizations, 'org-b')).toEqual(organizations[1])
    expect(isAllowedOrganizationId(organizations, 'org-b')).toBe(true)
  })

  it('rejects a tampered or removed organization ID and falls back to a valid one', () => {
    expect(selectValidOrganization(organizations, 'org-unknown')).toEqual(organizations[0])
    expect(isAllowedOrganizationId(organizations, 'org-unknown')).toBe(false)
  })

  it('returns no active organization when the API list is empty', () => {
    expect(selectValidOrganization([], 'org-a')).toBeNull()
    expect(isAllowedOrganizationId([], 'org-a')).toBe(false)
  })
})
