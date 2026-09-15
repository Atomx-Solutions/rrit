<script setup lang="ts">
const { t } = useI18n()
</script>
<template>
  <ULink to="/" :aria-label="t('public.brandHomeAria')" class="inline-flex items-center shrink-0"
    ><img src="/logo.svg" alt="" width="84" height="36" class="block dark:hidden" /><img
      src="/logo-light.svg"
      alt=""
      width="84"
      height="36"
      class="hidden dark:block"
  /></ULink>
</template>
