<script setup lang="ts">
const props = defineProps<{
  packageExpiry?: { packageName: string; endedAt: string } | null
}>()
const { t } = useI18n()
const { base } = useWorkspace()
const { ask } = useBillingRequest()
</script>

<template>
  <div
    v-if="props.packageExpiry"
    role="status"
    data-testid="package-expiry-banner"
    class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
  >
    <div class="flex items-start gap-3">
      <UIcon name="i-lucide-circle-alert" class="size-4 mt-0.5 text-warning shrink-0" />
      <div>
        <p class="text-sm font-medium">{{ t('packageExpiry.title') }}</p>
        <p class="text-xs text-muted mt-1">{{ t('packageExpiry.description', { package: props.packageExpiry.packageName }) }}</p>
      </div>
    </div>
    <UButton
      :to="`${base}/billing`"
      color="warning"
      variant="subtle"
      size="sm"
      :label="t('packageExpiry.requestPackage')"
      @click="ask('package')"
    />
  </div>
</template>
