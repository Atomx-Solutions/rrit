<script setup lang="ts">
import { z } from 'zod'
import { factInputProblem, type BrandFact } from '~~/shared/schemas/business-brain'
import { eventResearchCategoryKeys, videoDeliverablesDefault } from '~~/shared/schemas/workspace'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base, syncing, commit, notify } = useWorkspace()
const { t } = useI18n()
const route = useRoute()
useSeoMeta({ title: () => `${t('brand.title')} · Framic` })
const { form, clear, localError } = useDraft(
  `${base.value}:brand`,
  structuredClone(toRaw(data.value.brand)),
)
const eventCategories = eventResearchCategoryKeys
// A draft saved before this permission existed has no value for it, so the
// recovered form is brought up to the current brand shape before it is bound.
if (!form.videoDeliverables) form.videoDeliverables = { ...videoDeliverablesDefault }
const baseline = ref(JSON.stringify(form))
const openAccordion = ref<string | undefined>()
// The page is split into tabs by what the business has in mind; every tab's
// fields stay mounted, so switching never loses what was typed.
type BrandTab = 'profile' | 'audience' | 'facts' | 'rules' | 'planning'
const activeTab = ref<BrandTab>('profile')
// Leaving a tab with unsaved profile changes asks first, as leaving the page does.
const pendingTab = ref<BrandTab | null>(null)
const tab = computed({
  get: () => activeTab.value,
  set: (next: BrandTab) => {
    if (next === activeTab.value) return
    if (dirty.value) pendingTab.value = next
    else activeTab.value = next
  },
})
const currentTab = computed(() => tabs.value.find((item) => item.value === activeTab.value)!)
function closeTabGuard(open: boolean) {
  if (!open) pendingTab.value = null
}
function discardAndSwitch() {
  Object.assign(form, JSON.parse(baseline.value))
  brainEditor.value?.resetSettings()
  activeTab.value = pendingTab.value!
  pendingTab.value = null
}
async function saveAndSwitch() {
  await saveAll()
  if (dirty.value) return
  activeTab.value = pendingTab.value!
  pendingTab.value = null
}
const tabs = computed(() => [
  { label: t('brand.tabProfile'), value: 'profile', icon: 'i-lucide-store' },
  { label: t('brand.tabAudience'), value: 'audience', icon: 'i-lucide-message-circle' },
  { label: t('brand.tabFacts'), value: 'facts', icon: 'i-lucide-badge-check' },
  { label: t('brand.tabRules'), value: 'rules', icon: 'i-lucide-shield' },
  { label: t('brand.tabPlanning'), value: 'planning', icon: 'i-lucide-settings-2' },
])
const attentionTarget = ref('')
const saved = ref(false)
const formError = ref('')
const { onFormError, watchError } = useFormFeedback()
watchError(formError)
watchError(localError, 'warning')
const profileDirty = computed(() => JSON.stringify(form) !== baseline.value)
const brainEditor = ref<{ saveSettings: () => Promise<void>; settingsDirty: boolean; resetSettings: () => void } | null>(null)
const dirty = computed(() => profileDirty.value || !!brainEditor.value?.settingsDirty)
// The tab's one save button stores whichever part changed.
async function saveAll() {
  if (profileDirty.value) await save()
  if (brainEditor.value?.settingsDirty) await brainEditor.value.saveSettings()
}
const focusTarget = computed(() => {
  if (route.query.attention !== 'planner') return ''
  const value = route.query.focus
  return typeof value === 'string' && [
    'industry', 'audience', 'fact-text', 'fact-source', 'fact-confirmation', 'required',
  ].includes(value) ? value : ''
})
const showAllRequired = computed(() =>
  route.query.attention === 'planner' && route.query.required === '1',
)
function hasAttention(target: string) {
  if (attentionTarget.value !== target && !showAllRequired.value) return false
  const fact = form.facts[0]
  if (target === 'industry') return !form.industry.trim()
  if (target === 'audience') return !form.audience.trim()
  if (target === 'fact-text') return !fact?.text.trim()
  if (target === 'fact-source') return !fact?.source.trim()
  if (target === 'fact-confirmation') return !fact?.verified
  return false
}
function firstIncompleteTarget() {
  const fact = form.facts[0]
  if (!form.industry.trim()) return 'industry'
  if (!form.audience.trim()) return 'audience'
  if (!fact?.text.trim()) return 'fact-text'
  if (!fact?.source.trim()) return 'fact-source'
  if (!fact?.verified) return 'fact-confirmation'
  return ''
}
async function focusRequiredField(target: string) {
  if (!import.meta.client || !target) return
  activeTab.value = target === 'industry' || target === 'audience' ? 'profile' : 'facts'
  if (showAllRequired.value || target === 'required' || target.startsWith('fact-')) {
    openAccordion.value = 'facts'
    if (!form.facts.length) addFact()
  }
  attentionTarget.value = target
  await nextTick()
  const focusId = target === 'required' ? firstIncompleteTarget() : target
  document.getElementById(`${focusId}-input`)?.focus()
}
watch(
  () => route.hash,
  (hash) => {
    if (hash === '#facts') {
      activeTab.value = 'facts'
      openAccordion.value = 'facts'
    }
  },
  { immediate: true },
)
watch(focusTarget, (target) => { void focusRequiredField(target) }, { immediate: true })
const leaveOpen = ref(false)
let resolveLeave: ((allow: boolean) => void) | undefined
const schema = z.object({
  name: z.string().min(2, t('brand.nameRequired')),
  city: z.string().min(2, t('brand.cityRequired')),
  description: z.string().min(10, t('brand.descriptionRequired')),
  voice: z.string(),
  audience: z.string(),
  industry: z.string().max(200),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, t('brand.colorInvalid')),
  goals: z
    .array(z.string().trim().min(2, t('brand.goalMinLength')).max(120))
    .max(10),
  facts: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().max(1000),
        source: z.string().max(500),
        verified: z.boolean(),
      }),
    )
    .max(100),
  status: z.enum(['active', 'archived']),
})
function validResearchSource(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}
async function save() {
  formError.value = ''
  const snapshot = structuredClone(toRaw(form))
  snapshot.guardrails = (snapshot.guardrails || []).map((rule) => rule.trim()).filter(Boolean)
  snapshot.researchSources = [
    ...new Set((snapshot.researchSources || []).map((url) => url.trim())),
  ].filter(Boolean)
  if (snapshot.researchSources.some((url) => !validResearchSource(url))) {
    notify(t('brand.researchSourceInvalid'))
    return
  }
  const problem = snapshot.facts.map(factInputProblem).find(Boolean)
  if (problem) {
    notify(problem)
    return
  }
  if (
    await commit((d) => {
      d.brand = snapshot
    })
  ) {
    clear()
    Object.assign(form, structuredClone(toRaw(data.value.brand)))
    baseline.value = JSON.stringify(form)
    saved.value = true
    notify(t('brand.identitySaved'))
    await refreshNuxtData('monthly-planner')
  } else {
    formError.value = t('brand.saveError')
  }
}
function addGoal() {
  if (form.goals.length < 10) form.goals.push('')
}
function removeGoal(index: number) {
  form.goals.splice(index, 1)
}
function addFact() {
  form.facts.push({
    id: crypto.randomUUID(),
    text: '',
    source: t('brand.defaultSource'),
    verified: false,
  })
}
onBeforeRouteLeave(() => {
  if (!dirty.value || syncing.value) return true
  leaveOpen.value = true
  return new Promise<boolean>((resolve) => {
    resolveLeave = resolve
  })
})
function finishLeave(allow: boolean) {
  const resolve = resolveLeave
  resolveLeave = undefined
  leaveOpen.value = false
  resolve?.(allow)
}
function handleLeaveOpen(open: boolean) {
  if (!open && resolveLeave) finishLeave(false)
  else leaveOpen.value = open
}
function discardAndLeave() {
  finishLeave(true)
}
async function saveAndLeave() {
  await saveAll()
  if (!dirty.value) finishLeave(true)
}
function addResearchSource() {
  if ((form.researchSources || []).length < 10) (form.researchSources ||= []).push('')
}
function invalidateFact(fact: BrandFact) {
  fact.verified = false
  fact.state = 'proposed'
}
function setPrice(fact: BrandFact, value: string | number) {
  const amount = Number(value)
  fact.amountCents =
    value !== '' && Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null
  fact.currency = fact.amountCents == null ? null : 'CHF'
  invalidateFact(fact)
}
</script>
<template>
  <DashboardPage
    :title="t('brand.title')"
    :toolbar-border="false"
  >
    <div class="max-w-5xl">
      <div class="min-w-0 space-y-4">
      <!-- The tabs and the profile's history share one row and one line. -->
      <div class="flex items-center gap-2 border-b border-default">
        <UTabs
          v-model="tab"
          :items="tabs"
          :content="false"
          variant="link"
          class="min-w-0 flex-1"
          :aria-label="t('brand.sections')"
          :ui="{ list: 'border-0 flex-nowrap', trigger: 'min-w-0 flex-1 justify-center sm:flex-none', label: 'hidden sm:inline' }"
        />
        <BusinessBrainHistory class="shrink-0" />
      </div>
      <UCard :ui="{ body: 'p-5 sm:p-7' }"
        ><UForm
          :schema="schema"
          :state="form"
          class="space-y-6"
          @submit="saveAll"
          @error="onFormError"
          ><div class="flex gap-3 items-center mb-2">
            <UAvatar :icon="currentTab.icon" size="md" />
            <h2 class="text-base font-semibold">{{ currentTab.label }}</h2>
          </div>
          <div v-show="activeTab === 'profile'" class="space-y-6">
          <UFormField :label="t('brand.name')" name="name" required
            ><UInput v-model="form.name" class="w-full" maxlength="120"
          /></UFormField>
          <div class="grid sm:grid-cols-2 gap-5">
            <UFormField :label="t('brand.city')" name="city" required
              ><UInput
                v-model="form.city"
                class="w-full"
                :placeholder="t('brand.cityPlaceholder')" /></UFormField
            ><UFormField id="industry" :label="t('brand.industry')" name="industry" required
              ><UInput
                id="industry-input"
                v-model="form.industry"
                class="w-full"
                :class="{ 'rounded-lg ring-2 ring-success ring-offset-2 animate-pulse': hasAttention('industry') }"
                :placeholder="t('brand.industryPlaceholder')"
            /></UFormField>
          </div>
          <UFormField
            :label="t('brand.offer')"
            name="description"
            :description="t('brand.offerDescription')"
            required
            ><UTextarea
              v-model="form.description"
              :rows="4"
              maxlength="2000"
              class="w-full" /></UFormField>
          <!-- Every required field sits on this first tab, so the business can
               finish the essentials here; the other tabs are optional. -->
          <UFormField id="audience" :label="t('brand.audience')" name="audience" required
            ><UTextarea
              id="audience-input"
              v-model="form.audience"
              :rows="2"
              maxlength="1000"
              class="w-full"
              :class="{ 'rounded-lg ring-2 ring-success ring-offset-2 animate-pulse': hasAttention('audience') }"
              :placeholder="t('brand.audiencePlaceholder')"
          /></UFormField>
          <div class="grid sm:grid-cols-2 gap-5">
            <UFormField :label="t('brand.color')" name="color"
              ><UInput v-model="form.color" type="color" class="w-full h-10" /></UFormField
            ><UFormField :label="t('brand.status')" name="status"
              ><USelect
                v-model="form.status"
                :items="[
                  { label: t('brand.active'), value: 'active' },
                  { label: t('brand.archived'), value: 'archived' },
                ]"
            /></UFormField>
          </div>
          </div>
          <div v-show="activeTab === 'audience'" class="space-y-6 border-b border-default pb-6">
          <div class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold">{{ t('brand.goals') }}</h3>
              <p class="text-sm text-muted">{{ t('brand.goalsDescription') }}</p>
            </div>
            <div v-for="(_, i) in form.goals" :key="i" class="flex gap-2">
              <UInput
                v-model="form.goals[i]"
                class="w-full"
                :placeholder="t('brand.goalPlaceholder')"
              />
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                :aria-label="t('brand.removeGoal', { index: i + 1 })"
                @click="removeGoal(i)"
              />
            </div>
            <UButton
              v-if="form.goals.length < 10"
              variant="outline"
              icon="i-lucide-plus"
              class="ml-auto flex"
              @click="addGoal"
            >
              {{ t('brand.addGoal') }}
            </UButton>
          </div>
          </div>
          <UAccordion
v-show="activeTab === 'facts'"
            id="facts"
            v-model="openAccordion"
            class="border-b border-default"
            :items="[{ label: t('brand.facts'), slot: 'facts', value: 'facts' }]"
            ><template #facts
              ><div class="space-y-4 pb-4">
                <p class="text-sm text-muted leading-relaxed">
                  {{ t('brand.factsDescription') }}
                </p>
                <UCard
                  v-for="(fact, i) in form.facts"
                  :key="fact.id"
                  variant="outline"
                  :ui="{ body: 'p-4 space-y-3' }"
                  ><UFormField :label="t('brand.detailNumber', { index: i + 1 })" required
                    ><UTextarea
                      :id="i === 0 ? 'fact-text-input' : undefined"
                      v-model="fact.text"
                      class="w-full"
                      :class="{ 'rounded-lg ring-2 ring-success ring-offset-2 animate-pulse': i === 0 && hasAttention('fact-text') }"
                      :rows="2"
                      maxlength="1000"
                      @update:model-value="invalidateFact(fact)" /></UFormField
                  ><UFormField :label="t('brand.source')" required
                    ><UInput
                      :id="i === 0 ? 'fact-source-input' : undefined"
                      v-model="fact.source"
                      class="w-full"
                      maxlength="500"
                      :class="{ 'rounded-lg ring-2 ring-success ring-offset-2 animate-pulse': i === 0 && hasAttention('fact-source') }"
                      @update:model-value="invalidateFact(fact)"
                  /></UFormField>
                  <div class="grid sm:grid-cols-3 gap-3">
                    <UFormField :label="t('brand.type')">
                      <USelect
                        :model-value="fact.kind || 'fact'"
                        :items="[
                          { label: t('brand.fact'), value: 'fact' },
                          { label: t('brand.offerType'), value: 'offer' },
                        ]"
                        class="w-full"
                        @update:model-value="
                          (value) => {
                            fact.kind = value === 'offer' ? 'offer' : 'fact'
                            invalidateFact(fact)
                          }
                        "
                      />
                    </UFormField>
                    <UFormField :label="t('brand.validFromLabel')">
                      <UInput
                        type="date"
                        :model-value="fact.validFrom || ''"
                        class="w-full"
                        @update:model-value="
                          (value) => {
                            fact.validFrom = String(value) || null
                            invalidateFact(fact)
                          }
                        "
                      />
                    </UFormField>
                    <UFormField :label="t('brand.validUntilLabel')">
                      <UInput
                        type="date"
                        :model-value="fact.validUntil || ''"
                        class="w-full"
                        @update:model-value="
                          (value) => {
                            fact.validUntil = String(value) || null
                            invalidateFact(fact)
                          }
                        "
                      />
                    </UFormField>
                  </div>
                  <UFormField
                    v-if="fact.kind === 'offer'"
                    :label="t('brand.price')"
                    :description="t('brand.priceDescription')"
                  >
                    <UInput
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      :model-value="fact.amountCents == null ? '' : String(fact.amountCents / 100)"
                      @update:model-value="(value) => setPrice(fact, value)"
                    />
                  </UFormField>
                  <p v-if="fact.revision" class="text-xs text-muted">
                    {{ t('content.version', { version: fact.revision }) }} ·
                    {{ fact.verified ? t('brand.confirmedByBusiness') : t('brand.awaitingConfirmation') }}
                  </p>
                  <div class="flex items-center justify-between gap-3">
                    <UCheckbox
                      :id="i === 0 ? 'fact-confirmation-input' : undefined"
                      v-model="fact.verified"
                      :label="`${t('brand.checkedInformation')} *`"
                      :class="{ 'rounded-lg ring-2 ring-success ring-offset-2 animate-pulse': i === 0 && hasAttention('fact-confirmation') }"
                    /><UButton
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      :aria-label="t('brand.removeDetail', { index: i + 1 })"
                      @click="form.facts.splice(i, 1)"
                    /></div></UCard
                ><UButton variant="outline" icon="i-lucide-plus" class="ml-auto flex" @click="addFact"
                  >{{ t('brand.addDetail') }}</UButton
                >
              </div></template
            ></UAccordion
          >
          <div v-show="activeTab === 'planning'">
          <UAccordion class="border-b border-default" :items="[{ label: t('brand.researchSources'), slot: 'sources', value: 'sources' }]">
            <template #sources>
              <div class="space-y-3 pb-4">
                <p class="text-sm text-muted leading-relaxed">
                  {{ t('brand.researchDescription') }}
                </p>
                <div v-for="(_, i) in form.researchSources || []" :key="i" class="flex gap-2">
                  <UInput
                    v-model="form.researchSources![i]"
                    type="url"
                    inputmode="url"
                    maxlength="500"
                    :placeholder="t('brand.researchSourcePlaceholder')"
                    :aria-label="t('brand.sourceNumber', { index: i + 1 })"
                    class="flex-1"
                  />
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    :aria-label="t('brand.removeSource', { index: i + 1 })"
                    @click="form.researchSources!.splice(i, 1)"
                  />
                </div>
                <UButton
                  variant="outline"
                  icon="i-lucide-plus"
                  class="ml-auto flex"
                  :disabled="(form.researchSources?.length || 0) >= 10"
                  @click="addResearchSource"
                  >{{ t('brand.addSource') }}</UButton
                >
              </div>
            </template>
          </UAccordion>
          <UAccordion class="border-b border-default" :items="[{ label: t('brand.eventResearch'), slot: 'events', value: 'events' }]">
            <template #events>
              <div class="space-y-3 pb-4">
                <p class="text-sm text-muted leading-relaxed">
                  {{ t('brand.eventResearchDescription') }}
                </p>
                <UCheckbox
                  v-model="form.eventResearch.enabled"
                  :label="t('brand.eventResearchEnabled')"
                  :description="t('brand.eventResearchEnabledHint')"
                />
                <div class="space-y-2 ps-6">
                  <UCheckbox
                    v-for="category in eventCategories"
                    :key="category"
                    v-model="form.eventResearch.categories[category]"
                    :disabled="!form.eventResearch.enabled"
                    :label="t(`brand.eventCategory.${category}`)"
                    :description="t(`brand.eventCategoryHint.${category}`)"
                  />
                </div>
              </div>
            </template>
          </UAccordion>
          <UAccordion class="border-b border-default" :items="[{ label: t('brand.videoDeliverables'), slot: 'videos', value: 'videos' }]">
            <template #videos>
              <div class="space-y-3 pb-4">
                <p class="text-sm text-muted leading-relaxed">
                  {{ t('brand.videoDeliverablesDescription') }}
                </p>
                <UCheckbox
                  v-model="form.videoDeliverables.enabled"
                  :label="t('brand.videoDeliverablesEnabled')"
                  :description="t('brand.videoDeliverablesEnabledHint')"
                />
              </div>
            </template>
          </UAccordion>
          </div>
          <UAccordion v-show="activeTab === 'rules'" class="border-b border-default" :items="[{ label: t('brand.guardrails'), slot: 'guardrails', value: 'guardrails' }]">
            <template #guardrails>
              <div class="space-y-3 pb-4">
                <p class="text-sm text-muted">
                  {{ t('brand.guardrailsDescription') }}
                </p>
                <div v-for="(_, i) in form.guardrails || []" :key="i" class="flex gap-2">
                  <UInput
                    v-model="form.guardrails![i]"
                    :aria-label="t('brand.guidanceNumber', { index: i + 1 })"
                    maxlength="500"
                    class="flex-1"
                  />
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    :aria-label="t('brand.removeGuidance', { index: i + 1 })"
                    @click="form.guardrails!.splice(i, 1)"
                  />
                </div>
                <UButton
                  variant="outline"
                  icon="i-lucide-plus"
                  class="ml-auto flex"
                  :disabled="(form.guardrails?.length || 0) >= 20"
                  @click="(form.guardrails ||= []).push('')"
                  >{{ t('brand.addGuidance') }}</UButton
                >
              </div>
            </template>
          </UAccordion>
          <!-- The form's space-y leaves a gap after the section above; the
               editor closes it so every section sits the same distance apart. -->
          <BusinessBrainEditor
            v-if="activeTab === 'audience' || activeTab === 'facts' || activeTab === 'rules'"
            ref="brainEditor"
            class="-mt-6"
            :section="activeTab"
            embedded
          />
          <div class="-mx-5 flex items-center justify-between gap-3 border-t border-default px-5 pt-4 sm:-mx-7 sm:px-7">
            <span role="status" class="min-w-0 flex-1 truncate text-xs text-muted">{{
              dirty
                ? t('brand.unsaved')
                : saved
                  ? t('brand.identitySaved')
                  : t('brand.savedInAccount')
            }}</span
            ><UButton :loading="syncing" type="submit" icon="i-lucide-check" :disabled="!dirty" class="shrink-0"
              >{{ t('brand.saveIdentity') }}</UButton
            >
          </div></UForm
        ></UCard
      >
            </div>
    </div>
    <UnsavedChangesModal
      :open="!!pendingTab"
      :saving="syncing"
      @update:open="closeTabGuard"
      @save="saveAndSwitch"
      @discard="discardAndSwitch"
    />
    <UnsavedChangesModal
      :open="leaveOpen"
      :saving="syncing"
      @update:open="handleLeaveOpen"
      @save="saveAndLeave"
      @discard="discardAndLeave"
    />
  </DashboardPage>
</template>
