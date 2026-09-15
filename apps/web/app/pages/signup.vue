<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('auth.title.signup')} · Rrit`, robots: 'noindex' })
</script>
<template><AuthSurface mode="signup" /></template>
