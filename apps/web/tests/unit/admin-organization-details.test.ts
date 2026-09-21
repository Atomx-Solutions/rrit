import { describe, expect, it } from 'vitest'
import { isOrganizationId } from '../../server/utils/admin-organization-details'

describe('admin organization details', () => {
  it('accepts a valid organization UUID', () => {
    expect(isOrganizationId('c0194a0e-7952-4d08-8c85-927cd87594a7')).toBe(true)
  })

  it.each([
    undefined,
    '',
    'not-a-uuid',
    'c0194a0e-7952-4d08-8c85-927cd87594a',
  ])('rejects invalid organization id %s', (id) => {
    expect(isOrganizationId(id)).toBe(false)
  })
})
