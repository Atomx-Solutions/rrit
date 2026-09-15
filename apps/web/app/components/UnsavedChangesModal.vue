<script setup lang="ts">
const { t } = useI18n()
defineProps<{
  open: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: []
  discard: []
}>()
</script>

<template>
  <UModal
    :open="open"
    class="sm:max-w-xl"
    :title="t('public.unsavedTitle')"
    :description="t('public.unsavedDescription')"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex flex-wrap items-center gap-3 sm:gap-4">
        <UButton variant="outline" :loading="saving" @click="emit('save')">
          {{ t('common.save') }}
        </UButton>
        <UButton color="error" variant="outline" @click="emit('discard')">
          {{ t('common.discard') }}
        </UButton>
        <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">
          {{ t('public.stayHere') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
