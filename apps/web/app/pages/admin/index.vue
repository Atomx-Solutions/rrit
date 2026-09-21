<script setup lang="ts">
definePageMeta({ middleware: 'superadmin' })
useSeoMeta({ title: 'Admin · Rrit', robots: 'noindex, nofollow' })
const { data: admin } = await useFetch('/api/admin/me', { key: 'admin-me' })
</script>
<template>
  <main class="mx-auto max-w-3xl p-6">
    <UCard>
      <h1 class="text-lg font-semibold">Superadmin</h1>
      <p class="text-sm text-muted mt-1">{{ admin?.email }}</p>
    </UCard>
  </main>
</template>
