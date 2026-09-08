<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const route = useRoute()
useSeoMeta({ title: 'Redakto postimin · Rrit' })
</script>
<template><ContentEditor :id="String(route.params.id)" :key="String(route.params.id)" /></template>
