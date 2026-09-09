export function useLandingOffer() {
  const {
    data: capabilities,
    error,
    refresh,
  } = useFetch('/api/capabilities', {
    key: 'public-capabilities',
  })
  const trialDuration = computed(() => {
    const hours = capabilities.value?.trialHours
    if (!hours || hours <= 0) return null
    return hours % 24 === 0 ? `${hours / 24} ditë` : `${hours} orë`
  })
  const canRegister = computed(() => capabilities.value?.registration === true)
  const trialLabel = computed(() =>
    trialDuration.value ? `Provoje ${trialDuration.value} falas` : 'Krijo llogarinë tënde',
  )
  return { capabilities, error, refresh, trialDuration, canRegister, trialLabel }
}
