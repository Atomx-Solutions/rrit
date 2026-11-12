<script setup lang="ts">
import { de, en, fr, it, sq, tr } from '@nuxt/ui/locale'
const { locale: appLocale, t } = useI18n()
// The document language follows the interface, so screen readers pronounce it right.
useHead({ htmlAttrs: { lang: appLocale } })
// Proves site ownership to Bing Webmaster Tools when a token is configured.
const { bingSiteVerification } = useRuntimeConfig().public
if (bingSiteVerification) useHead({ meta: [{ name: 'msvalidate.01', content: bingSiteVerification }] })
const locale = computed(() => {
  const base = { 'de-CH': de, 'en-US': en, 'it-CH': it, 'fr-CH': fr, 'tr-TR': tr, 'sq-XK': sq }[appLocale.value] ?? de
  return {
    ...base,
    messages: {
      ...base.messages,
      dashboardSidebarToggle: { open: t('nav.open'), close: t('nav.close') },
      sidebar: { close: t('nav.close'), toggle: t('nav.toggle') },
    },
  }
})
</script>
<template>
  <UApp
    :locale="locale"
    :toaster="{ label: t('nav.notifications'), position: 'bottom-right', duration: 7000 }"
    ><NuxtLoadingIndicator color="var(--rrit-color-primary-strong)" /><NuxtLayout><NuxtPage keepalive /></NuxtLayout
  ></UApp>
</template>
