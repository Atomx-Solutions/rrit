import { watch, type Ref } from 'vue'

type FormError = {
  name?: string
  message: string
}

type FormErrorEvent = {
  errors?: FormError[]
}

type FeedbackColor = 'error' | 'warning'

export function useFormFeedback() {
  const { t } = useI18n()
  const toast = useToast()

  function showError(message: string, color: FeedbackColor = 'error') {
    if (!message) return
    toast.add({
      title: t('common.formError'),
      description: message,
      color,
      icon: 'i-lucide-circle-alert',
      duration: 7000,
    })
  }

  function showSuccess(message: string) {
    if (!message) return
    toast.add({
      title: message,
      color: 'success',
      icon: 'i-lucide-circle-check',
      duration: 7000,
    })
  }

  function onFormError(event: FormErrorEvent) {
    const first = event.errors?.[0]
    if (first) showError(first.message)
  }

  function watchError(source: Ref<string | null | undefined>, color: FeedbackColor = 'error') {
    watch(source, (message) => {
      if (message) showError(message, color)
    }, { immediate: true })
  }

  return { showError, showSuccess, onFormError, watchError }
}
