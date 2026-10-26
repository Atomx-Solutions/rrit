<script setup lang="ts">
import { DialogDescription, DialogTitle } from 'reka-ui'

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
  <!-- Saving is the one primary action; leaving without saving is set apart on
       the other side, so it is never the button a hurried tap lands on. On a
       phone the actions stack full width with saving on top. -->
  <UModal
    :open="open"
    class="sm:max-w-md"
    :title="t('public.unsavedTitle')"
    :description="t('public.unsavedDescription')"
    :ui="{
      header: 'flex items-start gap-3',
      footer: 'flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between',
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #header="{ close }">
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning"
        aria-hidden="true"
      >
        <UIcon name="i-lucide-triangle-alert" class="size-5" />
      </span>
      <div class="min-w-0 flex-1">
        <DialogTitle class="text-base font-semibold text-highlighted">{{ t('public.unsavedTitle') }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted leading-relaxed">{{ t('public.unsavedDescription') }}</DialogDescription>
      </div>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        class="-me-1.5 -mt-1"
        :aria-label="t('public.stayHere')"
        @click="close"
      />
    </template>
    <template #footer>
      <UButton
        color="error"
        variant="ghost"
        icon="i-lucide-log-out"
        class="w-full justify-center sm:w-auto"
        @click="emit('discard')"
      >
        {{ t('common.discard') }}
      </UButton>
      <div class="flex flex-col-reverse gap-2 sm:flex-row">
        <UButton
          color="neutral"
          variant="outline"
          class="w-full justify-center sm:w-auto"
          @click="emit('update:open', false)"
        >
          {{ t('public.stayHere') }}
        </UButton>
        <UButton
          icon="i-lucide-save"
          class="w-full justify-center sm:w-auto"
          :loading="saving"
          @click="emit('save')"
        >
          {{ t('common.save') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
