<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('auth.title.callback')} · Rrit`, robots: 'noindex' })
</script>
<template><AuthSurface mode="callback" /></template>
