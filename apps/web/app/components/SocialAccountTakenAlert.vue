<script setup lang="ts">
// Shown when the chosen account is already connected to another business.
// The owner's name is present only when the user is a member of that business.
const props = defineProps<{ network: string; owner?: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
// Split the sentence around the business name so the name can be emphasised.
const ownerParts = computed(() => {
  const marker = '<<business>>'
  const [before = '', after = ''] = t('social.takenOwner', { business: marker }).split(marker)
  return { before, after }
})
</script>
<template>
  <UAlert
    color="warning"
    variant="subtle"
    icon="i-lucide-link-2-off"
    :title="t('social.takenTitle', { network: props.network })"
    close
    :ui="{ title: 'text-sm font-semibold', description: 'text-xs leading-relaxed mt-1' }"
    @update:open="emit('close')"
  >
    <template #description>
      <span v-if="props.owner"
        >{{ ownerParts.before }}<strong class="font-semibold text-highlighted">{{ props.owner }}</strong
        >{{ ownerParts.after }}</span
      >
      <span v-else>{{ t('social.takenUnknown') }}</span>
    </template>
  </UAlert>
</template>
