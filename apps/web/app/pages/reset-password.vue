<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('auth.title.reset')} · Framic`, robots: 'noindex' })
</script>
<template><AuthSurface mode="reset" /></template>
