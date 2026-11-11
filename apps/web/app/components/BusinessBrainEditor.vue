<script setup lang="ts">
import { updateBrainSchema, type BusinessBrain } from '../../shared/schemas/business-brain'

// The content rules of "My business". Facts, offers, the tone and the
// audience are not here: they live in the workspace profile.
const props = defineProps<{ embedded?: boolean }>()
const route = useRoute()
const { t } = useI18n()
const { canonicalBrand, ready } = useWorkspace()
const brain = ref<BusinessBrain | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const { showSuccess, watchError } = useFormFeedback()
watchError(error)
const expandedBrainSections = reactive({
  guardrails: undefined as string | undefined,
})
const settings = reactive({
  guardrails: [] as Array<{ id?: string; text: string; source: string }>,
})

const organizationId = computed(() => String(route.params.org || ''))
const brandId = computed(() => canonicalBrand.value?.id || '')
const brandApiRoot = computed(
  () => `/api/organizations/${organizationId.value}/brands/${brandId.value}`,
)
const apiRoot = computed(() => `${brandApiRoot.value}/business-brain`)
function displayDefaultSource(source?: string) {
  return !source || source === 'brain.defaultSource' ? t('brain.defaultSource') : source
}

// What the settings were when last loaded, to tell whether they changed.
const settingsBaseline = ref('')
const settingsDirty = computed(() => !!brain.value && JSON.stringify(settings) !== settingsBaseline.value)
function resetSettings() {
  if (brain.value) syncSettings(brain.value)
}
function syncSettings(value: BusinessBrain) {
  settings.guardrails = value.guardrails
    .filter((item) => item.status === 'active')
    .map((item) => ({ id: item.id, text: item.text, source: displayDefaultSource(item.source) }))
  settingsBaseline.value = JSON.stringify(settings)
}

async function load() {
  if (!ready.value || !organizationId.value) return
  if (!brandId.value) {
    brain.value = null
    error.value = t('brain.brandUnavailable')
    return
  }
  const showInitialLoading = !brain.value
  if (showInitialLoading) loading.value = true
  error.value = ''
  try {
    brain.value = await $fetch<BusinessBrain>(apiRoot.value)
    syncSettings(brain.value)
  } catch (cause) {
    error.value = t((cause as { data?: { message?: string } }).data?.message || 'brain.loadError')
  } finally {
    if (showInitialLoading) loading.value = false
  }
}

async function run<T>(action: () => Promise<T>, success: string) {
  error.value = ''
  try {
    await action()
    showSuccess(success)
    await load()
  } catch (cause) {
    error.value = t((cause as { data?: { message?: string } }).data?.message || 'brain.actionError')
  }
}

async function saveSettings() {
  // Only the rules are sent; the tone and audience are saved with the profile.
  const body = {
    revision: brain.value!.revision,
    guardrails: settings.guardrails
      .filter((item) => item.text.trim())
      .map((item) => ({ ...item, text: item.text.trim(), source: item.source.trim() })),
  }
  const parsed = updateBrainSchema.safeParse(body)
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message || t('brain.actionError')
    return
  }
  saving.value = true
  try {
    await run(() => $fetch(apiRoot.value, { method: 'PUT', body: parsed.data }), t('brain.saved'))
  } finally {
    saving.value = false
  }
}

function addGuardrail() {
  settings.guardrails.push({ text: '', source: t('brain.defaultSource') })
}
function removeGuardrail(index: number) {
  settings.guardrails.splice(index, 1)
}

watch([ready, organizationId, brandId], load, { immediate: true })
defineExpose({ saveSettings, settingsDirty, resetSettings })
</script>

<template>
  <!-- Inside "My business" the editor sits in the tab's own card, without a
       card or heading of its own. -->
  <UCard :ui="props.embedded ? { root: 'ring-0 shadow-none bg-transparent rounded-none', body: 'p-0 sm:p-0' } : { body: 'p-0' }">
    <div v-if="!props.embedded" class="border-b border-default px-5 py-5 sm:px-7 sm:py-6">
      <h2 class="text-base font-semibold">{{ t('brain.title') }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t('brain.description') }}</p>
    </div>
    <div :class="props.embedded ? '' : 'space-y-8 p-5 sm:p-7'">
      <div v-if="loading" role="status" class="text-sm text-muted">{{ t('brain.loading') }}</div>
      <template v-else-if="brain">
        <UAccordion
          v-model="expandedBrainSections.guardrails"
          collapsible
          :items="[{ label: t('brain.guardrails'), slot: 'guardrails', value: 'guardrails' }]"
          class="border-b border-default"
        >
          <template #guardrails>
            <!-- Laid out like the profile's own guidance above: the hint, the
                 rules, then the add button under them. -->
            <div class="space-y-3 pb-4">
              <p class="text-sm text-muted">{{ t('brain.guardrailsDescription') }}</p>
              <div
                v-for="(guardrail, index) in settings.guardrails"
                :key="guardrail.id || index"
                class="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <UFormField :label="t('brain.rule', { index: index + 1 })" required
                  ><UInput
                    v-model="guardrail.text"
                    :aria-label="t('brain.rule', { index: index + 1 })"
                    :placeholder="t('brain.rulePlaceholder')"
                    class="w-full" /></UFormField
                ><UFormField :label="t('brain.source')" required
                  ><UInput
                    v-model="guardrail.source"
                    :aria-label="t('brain.source')"
                    :placeholder="t('brain.sourcePlaceholder')"
                    class="w-full"
                /></UFormField>
                <UButton
                  type="button"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  class="w-fit justify-self-end"
                  :aria-label="`${t('common.delete')} ${t('brain.rule', { index: index + 1 })}`"
                  @click.prevent.stop="removeGuardrail(index)"
                />
              </div>
              <div class="flex justify-end">
                <UButton
                  type="button"
                  variant="outline"
                  icon="i-lucide-plus"
                  @click.prevent.stop="addGuardrail"
                  >{{ t('brain.addRule') }}</UButton
                >
              </div>
            </div>
          </template>
        </UAccordion>

        <div v-if="!props.embedded" class="flex justify-end border-t border-default pt-6">
          <UButton
            type="button"
            class="w-full sm:w-auto"
            :loading="saving"
            icon="i-lucide-check"
            @click.prevent.stop="saveSettings"
            >{{ t('brain.save') }}</UButton
          >
        </div>
      </template>
    </div>
  </UCard>
</template>
