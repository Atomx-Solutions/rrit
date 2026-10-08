<script setup lang="ts">
import { workspaceHomeDestination } from '~/utils/workspace-home'

definePageMeta({ middleware: 'workspace' })
const { base, context, data } = useWorkspace()
const destination = workspaceHomeDestination({
  base: base.value,
  hasContext: Boolean(context.value),
  onboarding: data.value.onboarding,
  onboardingSkipped: data.value.onboardingSkipped,
})
if (context.value && destination === `${base.value}/overview`)
  useState<string | null>('workspace-home-redirect', () => null).value = destination
await navigateTo(destination, { replace: true })
</script>
<template>
  <div class="page"><USkeleton class="h-40 w-full" /></div>
</template>
