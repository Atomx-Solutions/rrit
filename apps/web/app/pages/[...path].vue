<script setup lang="ts">
definePageMeta({ layout: false })
const { t } = useI18n()

throw createError({
  statusCode: 404,
  statusMessage: t('public.errorNotFound'),
})
</script>

<template>
  <div aria-hidden="true" />
</template>
