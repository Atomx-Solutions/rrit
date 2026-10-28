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
  <!-- A centred alert: the warning, one sentence of context, then the choices.
       Only the close button (or "Stay here") dismisses it, so a stray tap
       outside never decides for the user. Saving is the one primary action;
       leaving without saving is the quietest, set apart below a divider. -->
  <UModal
    :open="open"
    :dismissible="false"
    :close="false"
    class="sm:max-w-sm"
    :title="t('public.unsavedTitle')"
    :description="t('public.unsavedDescription')"
    :ui="{ content: 'overflow-hidden', body: 'p-0 sm:p-0' }"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <div class="relative px-6 pt-8 pb-6 text-center">
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          class="absolute end-3 top-3 rounded-full"
          :aria-label="t('public.stayHere')"
          @click="emit('update:open', false)"
        />
        <span
          class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-warning/10 text-warning ring-1 ring-warning/20"
          aria-hidden="true"
        >
          <UIcon name="i-lucide-file-pen-line" class="size-6" />
        </span>
        <DialogTitle class="mt-4 text-lg font-semibold text-highlighted text-balance">
          {{ t('public.unsavedTitle') }}
        </DialogTitle>
        <DialogDescription class="mx-auto mt-2 max-w-72 text-sm text-muted leading-relaxed text-pretty">
          {{ t('public.unsavedDescription') }}
        </DialogDescription>
        <div class="mt-6 grid gap-2">
          <UButton icon="i-lucide-save" size="lg" block :loading="saving" @click="emit('save')">
            {{ t('common.save') }}
          </UButton>
          <UButton color="neutral" variant="soft" size="lg" block @click="emit('update:open', false)">
            {{ t('public.stayHere') }}
          </UButton>
        </div>
      </div>
      <div class="border-t border-default px-6 py-3">
        <UButton color="error" variant="link" size="sm" block icon="i-lucide-log-out" @click="emit('discard')">
          {{ t('common.discard') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
