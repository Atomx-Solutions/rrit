export function canReuseWorkspaceRedirect(
  pendingPath: string | null,
  destinationPath: string,
  ready: boolean,
  context: { id: string; slug: string } | null,
) {
  if (!ready || !context) return false
  return pendingPath === destinationPath
    && destinationPath === `/app/${context.id}/${context.slug}/overview`
}
