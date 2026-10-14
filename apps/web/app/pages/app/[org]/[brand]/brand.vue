<script setup lang="ts">
import { z } from 'zod'
import { factInputProblem, type BrandFact } from '~~/shared/schemas/business-brain'
import { eventResearchCategoryKeys, videoDeliverablesDefault } from '~~/shared/schemas/workspace'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base, syncing, commit, notify } = useWorkspace()
const { t } = useI18n()
useSeoMeta({ title: () => `${t('brand.title')} · Framic` })
const { form, clear, recovered, localError } = useDraft(
  `${base.value}:brand`,
  structuredClone(toRaw(data.value.brand)),
)
const eventCategories = eventResearchCategoryKeys
// A draft saved before this permission existed has no value for it, so the
// recovered form is brought up to the current brand shape before it is bound.
if (!form.videoDeliverables) form.videoDeliverables = { ...videoDeliverablesDefault }
const baseline = ref(JSON.stringify(form))
const saved = ref(false)
const formError = ref('')
const { onFormError, watchError } = useFormFeedback()
watchError(formError)
watchError(localError, 'warning')
const dirty = computed(() => JSON.stringify(form) !== baseline.value)
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
  facebookUrl: z
    .string()
    .refine((value) => !value || URL.canParse(value), t('brand.urlInvalid')),
  instagramUrl: z
    .string()
    .refine((value) => !value || URL.canParse(value), t('brand.urlInvalid')),
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
  await save()
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
    :description="t('brand.description')"
    :toolbar-border="false"
  >
    <UAlert
      v-if="recovered"
      color="neutral"
      variant="outline"
      icon="i-lucide-history"
      :title="t('brand.recoveredTitle')"
      :description="t('brand.recoveredDescription')"
    />
    <div class="grid xl:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start max-w-6xl">
      <UCard :ui="{ body: 'p-5 sm:p-7' }"
        ><UForm
          :schema="schema"
          :state="form"
          class="space-y-6"
          @submit="save"
          @error="onFormError"
          ><div class="flex gap-3 items-center mb-2">
            <UAvatar icon="i-lucide-store" size="md" />
            <h2 class="text-base font-semibold">{{ t('brand.profile') }}</h2>
          </div>
          <UFormField :label="t('brand.name')" name="name" required
            ><UInput v-model="form.name" class="w-full" maxlength="120"
          /></UFormField>
          <div class="grid sm:grid-cols-2 gap-5">
            <UFormField :label="t('brand.city')" name="city" required
              ><UInput
                v-model="form.city"
                class="w-full"
                :placeholder="t('brand.cityPlaceholder')" /></UFormField
            ><UFormField :label="t('brand.industry')" name="industry"
              ><UInput v-model="form.industry" class="w-full" :placeholder="t('brand.industryPlaceholder')"
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
              class="w-full" /></UFormField
          ><UFormField :label="t('brand.audience')" name="audience"
            ><UTextarea
              v-model="form.audience"
              :rows="2"
              maxlength="1000"
              class="w-full"
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
          <UFormField
            :label="t('brand.socialLinks')"
            :description="t('brand.socialLinksDescription')"
          >
            <div class="grid sm:grid-cols-2 gap-5">
              <UFormField name="facebookUrl">
                <UInput
                  v-model="form.facebookUrl"
                  :aria-label="t('brand.facebookUrl')"
                  :placeholder="t('brand.facebookPlaceholder')"
                />
              </UFormField>
              <UFormField name="instagramUrl">
                <UInput
                  v-model="form.instagramUrl"
                  :aria-label="t('brand.instagramUrl')"
                  :placeholder="t('brand.instagramPlaceholder')"
                />
              </UFormField>
            </div>
          </UFormField>
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
              color="neutral"
              variant="outline"
              icon="i-lucide-plus"
              @click="addGoal"
            >
              {{ t('brand.addGoal') }}
            </UButton>
          </div>
          <UAccordion
            :items="[{ label: t('brand.facts'), slot: 'facts' }]"
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
                  ><UFormField :label="t('brand.detailNumber', { index: i + 1 })"
                    ><UTextarea
                      v-model="fact.text"
                      class="w-full"
                      :rows="2"
                      maxlength="1000"
                      @update:model-value="invalidateFact(fact)" /></UFormField
                  ><UFormField :label="t('brand.source')"
                    ><UInput
                      v-model="fact.source"
                      class="w-full"
                      maxlength="500"
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
                      v-model="fact.verified"
                      :label="t('brand.checkedInformation')"
                    /><UButton
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      :aria-label="t('brand.removeDetail', { index: i + 1 })"
                      @click="form.facts.splice(i, 1)"
                    /></div></UCard
                ><UButton color="neutral" variant="outline" icon="i-lucide-plus" @click="addFact"
                  >{{ t('brand.addDetail') }}</UButton
                >
              </div></template
            ></UAccordion
          >
          <UAccordion :items="[{ label: t('brand.researchSources'), slot: 'sources' }]">
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
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-plus"
                  :disabled="(form.researchSources?.length || 0) >= 10"
                  @click="addResearchSource"
                  >{{ t('brand.addSource') }}</UButton
                >
              </div>
            </template>
          </UAccordion>
          <UAccordion :items="[{ label: t('brand.eventResearch'), slot: 'events' }]">
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
          <UAccordion :items="[{ label: t('brand.videoDeliverables'), slot: 'videos' }]">
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
          <UAccordion :items="[{ label: t('brand.guardrails'), slot: 'guardrails' }]">
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
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-plus"
                  :disabled="(form.guardrails?.length || 0) >= 20"
                  @click="(form.guardrails ||= []).push('')"
                  >{{ t('brand.addGuidance') }}</UButton
                >
              </div>
            </template>
          </UAccordion>
          <USeparator />
          <div class="flex flex-wrap items-center justify-between gap-4">
            <span role="status" class="text-xs text-muted">{{
              dirty
                ? t('brand.unsaved')
                : saved
                  ? t('brand.identitySaved')
                  : t('brand.savedInAccount')
            }}</span
            ><UButton :loading="syncing" variant="outline" type="submit" icon="i-lucide-check"
              >{{ t('brand.saveIdentity') }}</UButton
            >
          </div></UForm
        ></UCard
      >
      <aside class="space-y-5 xl:sticky xl:top-6">
        <BusinessBrainHistory />
        <UCard variant="outline" :ui="{ body: 'p-5 space-y-5' }"
          ><UUser
            :name="form.name"
            :description="form.city"
            :avatar="{ alt: form.name }"
            size="lg"
          /><USeparator />
          <p class="text-sm text-muted leading-relaxed">
            {{ t('brand.profileInfo') }}
          </p>
          <UButton
            :to="`${base}/social-posts`"
            color="neutral"
            variant="outline"
            block
            trailing-icon="i-lucide-arrow-right"
            >{{ t('brand.socialPosts') }}</UButton
          ></UCard
        ><UCard :ui="{ body: 'p-5 space-y-4' }"
          ><UIcon name="i-lucide-camera" class="size-5 text-primary" />
          <h2 class="text-sm font-semibold">{{ t('brand.photosTitle') }}</h2>
          <p class="text-sm text-muted leading-relaxed">
            {{ t('brand.photosDescription') }}
          </p>
          <UButton
            :to="`${base}/gallery`"
            variant="link"
            class="p-0"
            trailing-icon="i-lucide-arrow-right"
            >{{ t('brand.openGallery') }}</UButton
          ></UCard
        >
      </aside>
    </div>
    <BusinessBrainEditor />
    <UnsavedChangesModal
      :open="leaveOpen"
      :saving="syncing"
      @update:open="handleLeaveOpen"
      @save="saveAndLeave"
      @discard="discardAndLeave"
    />
  </DashboardPage>
</template>
