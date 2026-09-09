<script setup lang="ts">
import { sq } from '@nuxt/ui/locale'
const locale = {
  ...sq,
  messages: {
    ...sq.messages,
    dashboardSidebarToggle: { open: 'Hap navigimin', close: 'Mbyll navigimin' },
    sidebar: { close: 'Mbyll navigimin', toggle: 'Ndrysho gjerësinë e menusë' },
  },
}
</script>
<template>
  <UApp :locale="locale" :toaster="{ label: 'Njoftimet' }"
    ><NuxtLoadingIndicator color="var(--rrit-color-primary-strong)" /><NuxtLayout><NuxtPage /></NuxtLayout
  ></UApp>
</template>
