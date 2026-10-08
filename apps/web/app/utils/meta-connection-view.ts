export type MetaConnectionView = 'loading' | 'connected' | 'disconnected' | 'unavailable'

export function metaConnectionView(
  requestStatus: 'idle' | 'pending' | 'success' | 'error',
  connection: { status: string } | null | undefined,
): MetaConnectionView {
  if (requestStatus === 'idle' || requestStatus === 'pending') return 'loading'
  if (requestStatus === 'error') return 'unavailable'
  return connection?.status === 'connected' ? 'connected' : 'disconnected'
}
