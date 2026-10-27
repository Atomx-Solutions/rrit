type ActivePackage = { name: string } | null
type EndedPackage = { name: string; endsAt: Date } | null

/**
 * A package-end prompt is derived from entitlement state, rather than stored
 * as a dismissible notification. A replacement in force always wins.
 */
export function packageExpiryNotification(activePackage: ActivePackage, endedPackage: EndedPackage) {
  if (activePackage || !endedPackage) return null
  return {
    packageName: endedPackage.name,
    endedAt: endedPackage.endsAt.toISOString(),
  }
}
