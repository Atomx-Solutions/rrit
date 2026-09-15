import type { ZodType } from 'zod'
export interface ApiProblem {
  title: string
  detail?: string
  status: number
  requestId?: string
}
// Single transport boundary; no provider SDK or secret can enter a page.
export function useApi() {
  const config = useRuntimeConfig()
  const { t } = useI18n()
  async function request<T>(
    path: string,
    schema: ZodType<T>,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
      body?: Record<string, unknown>
      signal?: AbortSignal
      revision?: number
      idempotencyKey?: string
    } = {},
  ) {
    if (!config.public.apiBase)
      throw { title: t('api.serviceNotConfigured'), status: 503 } satisfies ApiProblem
    const response = await $fetch<unknown>(path, {
      baseURL: config.public.apiBase,
      credentials: 'include',
      timeout: 15000,
      retry: 0,
      method: options.method || 'GET',
      body: options.body,
      signal: options.signal,
      headers: {
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        ...(options.revision ? { 'If-Match': String(options.revision) } : {}),
      },
    })
    return schema.parse(response)
  }
  return { request }
}
