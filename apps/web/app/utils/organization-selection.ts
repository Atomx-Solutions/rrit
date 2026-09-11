export function selectValidOrganization<T extends { id: string }>(
  organizations: readonly T[],
  preferredId: string | null,
): T | null {
  if (preferredId) {
    const preferred = organizations.find((organization) => organization.id === preferredId)
    if (preferred) return preferred
  }
  return organizations[0] ?? null
}

export function isAllowedOrganizationId(
  organizations: readonly { id: string }[],
  candidateId: string | null,
) {
  return Boolean(candidateId && organizations.some((organization) => organization.id === candidateId))
}
