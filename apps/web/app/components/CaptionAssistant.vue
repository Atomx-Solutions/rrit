<script setup lang="ts">
const props = defineProps<{
  caption: string
  channel: 'Facebook' | 'Instagram'
  disabled?: boolean
}>()
const { t } = useI18n()
const emit = defineEmits<{ apply: [caption: string] }>()
const { data: capabilities } = await useFetch('/api/capabilities')
const open = ref(false),
  busy = ref(false),
  idea = ref(''),
  error = ref('')
const result = ref<{ variants: { caption: string; note: string }[]; questions: string[] } | null>(
  null,
)
async function generate() {
  busy.value = true
  error.value = ''
  try {
    result.value = await $fetch('/api/ai/captions', {
      method: 'POST',
      body: {
        requestId: crypto.randomUUID(),
        idea: idea.value,
        caption: props.caption,
        channel: props.channel,
      },
      retry: 0,
      timeout: 55000,
    })
  } catch (problem) {
    const response = problem as { data?: { message?: string; data?: { code?: string } } }
    error.value = response.data?.data?.code === 'CREDIT_WALLET_EXHAUSTED'
      ? t('caption.generationCreditsExhausted')
      : response.data?.message || t('caption.generationError')
  } finally {
    busy.value = false
  }
}
function apply(caption: string) {
  emit('apply', caption)
  open.value = false
}
</script>
<template>
  <UButton variant="outline" icon="i-lucide-sparkles" :disabled="disabled" @click="open = true"
    >{{ t('caption.prepareWithAi') }}</UButton
  >
  <UModal
    v-model:open="open"
    :title="t('caption.title')"
    :description="t('caption.description')"
  >
    <template #body
      ><div class="space-y-5">
        <UAlert
          v-if="!capabilities?.ai"
          color="neutral"
          variant="outline"
          :title="t('caption.unavailableTitle')"
          :description="t('caption.unavailableDescription')"
        />
        <UForm v-else :state="{ idea }" class="space-y-4" @submit="generate"
          ><UFormField :label="t('caption.ideaLabel')" required
            ><UTextarea
              v-model="idea"
              :disabled="busy"
              :maxlength="1000"
              :placeholder="t('caption.ideaPlaceholder')"
              class="w-full" /></UFormField
          ><UButton
            type="submit"
            variant="outline"
            :loading="busy"
            :disabled="idea.trim().length < 5"
            >{{ t('caption.prepareVariants') }}</UButton
          ></UForm
        >
        <UAlert v-if="error" color="error" variant="outline" :title="error" />
        <template v-if="result"
          ><UCard v-for="(variant, index) in result.variants" :key="index"
            ><p class="text-sm whitespace-pre-wrap">{{ variant.caption }}</p>
            <p class="text-xs text-muted mt-4">{{ variant.note }}</p>
            <UButton
              variant="outline"
              color="neutral"
              class="mt-4"
              :disabled="disabled"
              @click="apply(variant.caption)"
              >{{ t('caption.useText') }}</UButton
            ></UCard
          >
          <ul v-if="result.questions.length" class="list-disc ps-5 space-y-2 text-sm text-muted">
            <li v-for="question in result.questions" :key="question">{{ question }}</li>
          </ul>
          <p class="text-xs text-muted">
            {{ t('caption.reviewNote') }}
          </p></template
        >
      </div></template
    >
  </UModal>
</template>
