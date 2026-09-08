// Shared low-risk authoring recovery. Conflict resolution stays in the repository.
export function useDraft<T extends object>(key: string, initial: T) {
  const form = reactive(structuredClone(initial)) as T
  const recovered = ref(false)
  const localError = ref('')
  onMounted(() => {
    try {
      const raw = sessionStorage.getItem(`rrit:draft:${key}`)
      if (raw) {
        const value: unknown = JSON.parse(raw)
        if (
          value &&
          typeof value === 'object' &&
          Object.entries(initial).every(
            ([k, v]) => k in value && typeof (value as Record<string, unknown>)[k] === typeof v,
          )
        ) {
          for (const k of Object.keys(initial))
            Object.assign(form, { [k]: (value as Record<string, unknown>)[k] })
          recovered.value = true
        }
      }
    } catch {
      localError.value = 'Rikuperimi lokal nuk është i disponueshëm.'
    }
  })
  watch(
    form,
    () => {
      try {
        sessionStorage.setItem(`rrit:draft:${key}`, JSON.stringify(form))
        localError.value = ''
      } catch {
        localError.value = 'Drafti nuk mund të ruhet për rikuperim.'
      }
    },
    { deep: true },
  )
  function clear() {
    try {
      sessionStorage.removeItem(`rrit:draft:${key}`)
      recovered.value = false
      localError.value = ''
    } catch {
      localError.value = 'Kopja e rikuperimit nuk mund të pastrohet në këtë shfletues.'
    }
  }
  return { form, recovered, localError, clear }
}
