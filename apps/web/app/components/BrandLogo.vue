<script setup lang="ts">
const { t } = useI18n()
</script>
<template>
  <ULink to="/" :aria-label="t('public.brandHomeAria')" class="inline-flex items-center shrink-0"
    ><img src="/framic-logo.png" alt="Framic" width="220" height="76" class="block h-9 w-auto object-contain dark:hidden" /><img
      src="/framic-logo.png"
      alt="Framic"
      width="220"
      height="76"
      class="hidden h-9 w-auto object-contain dark:block"
  /></ULink>
</template>
