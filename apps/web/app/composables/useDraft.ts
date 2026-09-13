const DRAFT_VERSION = 2

type StoredDraft<T> = {
  version: typeof DRAFT_VERSION
  baseline: string
  value: T
}

function draftBaseline(value: object) {
  return JSON.stringify(value)
}

export function recoverStoredDraft<T extends object>(raw: string, initial: T): T | null {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') return null
  const draft = parsed as Partial<StoredDraft<T>>
  if (
    draft.version !== DRAFT_VERSION ||
    draft.baseline !== draftBaseline(initial) ||
    !draft.value ||
    typeof draft.value !== 'object'
  )
    return null
  if (
    !Object.entries(initial).every(
      ([key, value]) =>
        key in draft.value! &&
        typeof (draft.value as Record<string, unknown>)[key] === typeof value,
    )
  )
    return null
  return draft.value
}

// Shared low-risk authoring recovery. Conflict resolution stays in the repository.
export function useDraft<T extends object>(key: string, initial: T) {
  const form = reactive(structuredClone(initial)) as T
  const recovered = ref(false)
  const localError = ref('')
  const storageKey = `rrit:draft:${key}`
  const baseline = draftBaseline(initial)
  onMounted(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const value = recoverStoredDraft(raw, initial)
        if (value) {
          for (const key of Object.keys(initial))
            Object.assign(form, { [key]: (value as Record<string, unknown>)[key] })
          recovered.value = true
        } else sessionStorage.removeItem(storageKey)
      }
    } catch {
      sessionStorage.removeItem(storageKey)
      localError.value = 'Rikuperimi lokal nuk është i disponueshëm.'
    }
  })
  watch(
    form,
    () => {
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            version: DRAFT_VERSION,
            baseline,
            value: form,
          } satisfies StoredDraft<T>),
        )
        localError.value = ''
      } catch {
        localError.value = 'Drafti nuk mund të ruhet për rikuperim.'
      }
    },
    { deep: true },
  )
  function clear() {
    try {
      sessionStorage.removeItem(storageKey)
      recovered.value = false
      localError.value = ''
    } catch {
      localError.value = 'Kopja e rikuperimit nuk mund të pastrohet në këtë shfletues.'
    }
  }
  return { form, recovered, localError, clear }
}
