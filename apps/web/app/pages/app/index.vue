<script setup lang="ts">
definePageMeta({ middleware: 'workspace' })
const { base, context } = useWorkspace()
await navigateTo(context.value ? `${base.value}/overview` : '/onboarding', { replace: true })
</script>
<template>
  <div class="page"><USkeleton class="h-40 w-full" /></div>
</template>
