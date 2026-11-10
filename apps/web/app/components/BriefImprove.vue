<script setup lang="ts">
/**
 * "Improve with AI" for one field of the sign-up brief. The suggestion is shown
 * under the field and changes nothing until the person chooses to use it.
 */
const props = defineProps<{
  field: 'description' | 'audience' | 'fact'
  text: string
  business: { name: string; city: string; industry: string; description: string; audience: string }
  // Under My business the business exists, so improving is charged to its
  // credits instead of the free sign-up allowance.
  paid?: boolean
}>()
const emit = defineEmits<{ apply: [text: string] }>()
// Shared by every field on the page: the free improvements are one allowance.
const remaining = defineModel<number | null>('remaining', { default: null })
const { t, locale } = useI18n()
const busy = ref(false)
const error = ref('')
const suggestion = ref<{ text: string; questions: string[] } | null>(null)
const tooShort = computed(() => props.text.trim().length < 3)
const usedUp = computed(() => !props.paid && remaining.value === 0)

async function improve() {
  if (busy.value || tooShort.value || usedUp.value) return
  busy.value = true
  error.value = ''
  try {
    const body = { field: props.field, text: props.text, business: props.business, locale: locale.value }
    const result = await $fetch<{ text: string; questions: string[]; remaining?: number }>(
      props.paid ? '/api/business/improve' : '/api/onboarding/improve',
      {
        method: 'POST',
        body: props.paid ? { ...body, requestId: crypto.randomUUID() } : body,
        retry: 0,
      },
    )
    if (result.remaining !== undefined) remaining.value = result.remaining
    suggestion.value = { text: result.text, questions: result.questions }
  } catch (problem) {
    const message = (problem as { data?: { message?: string } }).data?.message
    if (message === 'server.BRIEF_IMPROVEMENTS_USED') remaining.value = 0
    error.value = t(message || 'onboarding.improveFailed')
  } finally {
    busy.value = false
  }
}
function use() {
  if (!suggestion.value) return
  emit('apply', suggestion.value.text)
  suggestion.value = null
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center justify-end gap-2">
      <!-- A failure is one short line beside the button, the full message on hover. -->
      <UTooltip v-if="error" :text="error">
        <span role="alert" class="mr-auto inline-flex min-w-0 items-center gap-1 text-xs text-error">
          <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
          <span class="truncate">{{ t('onboarding.improveFailedShort') }}</span>
        </span>
      </UTooltip>
      <span v-if="paid" class="text-xs text-muted">{{ t('brand.improveUsesCredits') }}</span>
      <span v-else-if="remaining !== null" class="text-xs text-muted">
        {{ usedUp ? t('onboarding.improveUsedUp') : t('onboarding.improveRemaining', { count: remaining }) }}
      </span>
      <UTooltip :text="tooShort ? t('onboarding.improveWriteFirst') : t('onboarding.improveHint')">
        <!-- The same look as "Improve with AI" on a post photo. -->
        <UButton
          type="button"
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-sparkles"
          :loading="busy"
          :disabled="tooShort || usedUp"
          @click="improve"
        >
          {{ busy ? t('onboarding.improving') : t('onboarding.improveWithAi') }}
        </UButton>
      </UTooltip>
    </div>
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="suggestion"
        class="rounded-xl border border-primary/25 bg-primary/5 p-3"
        role="region"
        :aria-label="t('onboarding.aiSuggestion')"
      >
        <div class="flex items-center gap-1.5 text-xs font-medium text-primary">
          <UIcon name="i-lucide-sparkles" class="size-3.5" />
          {{ t('onboarding.aiSuggestion') }}
        </div>
        <p class="mt-2 whitespace-pre-line text-sm leading-6 text-highlighted">{{ suggestion.text }}</p>
        <ul v-if="suggestion.questions.length" class="mt-3 space-y-1 border-t border-primary/15 pt-2">
          <li
            v-for="question in suggestion.questions"
            :key="question"
            class="flex gap-1.5 text-xs leading-5 text-muted"
          >
            <UIcon name="i-lucide-circle-help" class="mt-0.5 size-3.5 shrink-0" />
            {{ question }}
          </li>
        </ul>
        <div class="mt-3 flex flex-wrap gap-2">
          <UButton size="xs" icon="i-lucide-check" @click="use">{{ t('onboarding.useSuggestion') }}</UButton>
          <UButton size="xs" color="neutral" variant="ghost" @click="suggestion = null">
            {{ t('onboarding.keepMine') }}
          </UButton>
        </div>
      </div>
    </Transition>
  </div>
</template>
