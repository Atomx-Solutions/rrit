<script setup lang="ts">
import { en, sq } from '@nuxt/ui/locale'
const { locale: appLocale, setLocale, t } = useI18n()
const { data, ready } = useWorkspace()
const locale = computed(() => {
  const base = appLocale.value === 'en-US' ? en : sq
  return {
    ...base,
    messages: {
      ...base.messages,
      dashboardSidebarToggle: { open: t('nav.open'), close: t('nav.close') },
      sidebar: { close: t('nav.close'), toggle: t('nav.toggle') },
    },
  }
})
watch(
  [ready, () => data.value.preferences.locale],
  ([isReady, workspaceLocale]) => {
    if (isReady) setLocale(workspaceLocale)
  },
  { immediate: true },
)
</script>
<template>
  <UApp
    :locale="locale"
    :toaster="{ label: t('nav.notifications'), position: 'bottom-right', duration: 7000 }"
    ><NuxtLoadingIndicator color="var(--rrit-color-primary-strong)" /><NuxtLayout><NuxtPage /></NuxtLayout
  ></UApp>
</template>
