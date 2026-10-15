export type BillingRequest = 'package' | 'credits'

/**
 * Asks the billing page to open one of its request dialogs. It is shared state
 * rather than only a URL, because following a link to the page you are already
 * on changes nothing and would open nothing.
 */
export function useBillingRequest() {
  const pending = useState<{ request: BillingRequest; at: number } | null>('billing-request', () => null)
  function ask(request: BillingRequest) {
    pending.value = { request, at: Date.now() }
  }
  return { pending, ask }
}
