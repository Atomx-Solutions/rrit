<script setup lang="ts">
import { imageFallback, imageSrcset } from '~~/shared/utils/responsive-image'
const { t } = useI18n()
const logo = '/framic-logo-small.webp'
</script>
<template>
  <ULink to="/" :aria-label="t('public.brandHomeAria')" class="inline-flex items-center shrink-0"
    ><img
      :src="imageFallback(logo)"
      :srcset="imageSrcset(logo)"
      sizes="104px"
      alt="Framic"
      width="440"
      height="189"
      decoding="async"
      class="block h-9 w-auto object-contain"
  /></ULink>
</template>
