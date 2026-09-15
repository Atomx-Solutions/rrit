<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('auth.title.login')} · Rrit`, robots: 'noindex' })
</script>
<template><AuthSurface mode="login" /></template>
