<script setup lang="ts">
definePageMeta({ middleware: 'workspace' })
const { base, context, data } = useWorkspace()
const destination = !context.value
  ? '/onboarding'
  : data.value.onboardingSkipped
    ? `${base.value}/overview`
  : data.value.onboarding < 3
    ? '/onboarding'
    : data.value.onboarding === 3
      ? `${base.value}/content/new`
      : `${base.value}/overview`
await navigateTo(destination, { replace: true })
</script>
<template>
  <div class="page"><USkeleton class="h-40 w-full" /></div>
</template>
