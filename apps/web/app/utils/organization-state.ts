/**
 * The one state an organization is read by, decided in the database by
 * organization_state and surfaced unchanged everywhere it appears. A package in
 * force governs the account; when none does, the trial or subscription left
 * behind does.
 */
export type OrganizationState
  = 'active' | 'trialing' | 'paused' | 'draft' | 'expired' | 'cancelled' | 'none'

export const organizationStates: OrganizationState[] = [
  'active',
  'trialing',
  'paused',
  'draft',
  'expired',
  'cancelled',
  'none',
]

// Green only while the account can actually generate; blue for what is coming.
export const organizationStateColors: Record<OrganizationState, 'success' | 'info' | 'warning' | 'neutral'> = {
  active: 'success',
  trialing: 'info',
  draft: 'info',
  paused: 'warning',
  expired: 'neutral',
  cancelled: 'neutral',
  none: 'neutral',
}

export function organizationState(value: string | null | undefined): OrganizationState {
  return organizationStates.includes(value as OrganizationState)
    ? (value as OrganizationState)
    : 'none'
}
