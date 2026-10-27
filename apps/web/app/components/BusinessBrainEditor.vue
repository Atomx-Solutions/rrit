<script setup lang="ts">
import {
  updateBrainSchema,
  type BusinessBrain,
  type BusinessBrainFact,
  type CreateOffer,
} from '../../shared/schemas/business-brain'

const route = useRoute()
const { t } = useI18n()
const { data, canonicalBrand, ready } = useWorkspace()
const brain = ref<BusinessBrain | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const { showSuccess, watchError } = useFormFeedback()
watchError(error)
const editingFact = ref<string | null>(null)
const factSaving = ref(false)
const editFact = reactive({ text: '', source: '', confidence: 1 })
const newFactOpen = ref(false)
const newFact = reactive({
  kind: 'candidate' as 'candidate' | 'explicit',
  text: '',
  source: '',
  confidence: 1,
})
const newOfferOpen = ref(false)
const editingOffer = ref<string | null>(null)
const offerSaving = ref(false)
const expandedBrainSections = reactive({
  facts: 'facts' as string | undefined,
  voice: undefined as string | undefined,
  audiences: undefined as string | undefined,
  offers: undefined as string | undefined,
  guardrails: undefined as string | undefined,
})
const offer = reactive<CreateOffer>({
  name: '',
  description: '',
  currency: 'CHF',
  amount: null,
  validFrom: new Date().toISOString().slice(0, 10),
  validUntil: null,
  source: t('brain.defaultSource'),
  confidence: 1,
})
const editOffer = reactive<CreateOffer>({
  name: '',
  description: '',
  currency: 'CHF',
  amount: null,
  validFrom: '',
  validUntil: null,
  source: '',
  confidence: 1,
})
const settings = reactive({
  voice: { text: '', source: t('brain.defaultSource') },
  audiences: [] as Array<{ id?: string; name: string; description: string }>,
  guardrails: [] as Array<{ id?: string; text: string; source: string }>,
})

const organizationId = computed(() => String(route.params.org || ''))
const brandId = computed(() => canonicalBrand.value?.id || '')
const brandApiRoot = computed(
  () => `/api/organizations/${organizationId.value}/brands/${brandId.value}`,
)
const apiRoot = computed(() => `${brandApiRoot.value}/business-brain`)
function displaySource(source: string) {
  return source === 'Informacion i dhënë nga pronari i biznesit'
    ? t('brain.businessOwnerSource')
    : source
}

function displayDefaultSource(source?: string) {
  return !source || source === 'brain.defaultSource' ? t('brain.defaultSource') : source
}

function syncSettings(value: BusinessBrain) {
  const activeVoice = value.voiceVersions.find((item) => item.active)
  settings.voice.text = activeVoice?.text || data.value.brand.voice || ''
  settings.voice.source = displayDefaultSource(activeVoice?.source)
  settings.audiences = value.audiences
    .filter((item) => item.status === 'active')
    .map((item) => ({ id: item.id, name: item.name, description: item.description }))
  settings.guardrails = value.guardrails
    .filter((item) => item.status === 'active')
    .map((item) => ({ id: item.id, text: item.text, source: displayDefaultSource(item.source) }))
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

function startFactEdit(fact: BusinessBrainFact) {
  editingFact.value = fact.id
  editFact.text = fact.text
  editFact.source = fact.source
  editFact.confidence = fact.confidence
}

async function saveFact(factId: string) {
  factSaving.value = true
  try {
    await run(
      () =>
        $fetch(`${brandApiRoot.value}/facts/${factId}`, {
          method: 'PUT',
          body: { ...editFact, sourceUrl: null },
        }),
      t('brain.factSaved'),
    )
  } finally {
    factSaving.value = false
  }
  editingFact.value = null
}

async function createFact() {
  if (!newFact.text.trim() || !newFact.source.trim()) {
    error.value = t('brain.factRequired')
    return
  }
  await run(
    () =>
      $fetch(`${brandApiRoot.value}/facts`, {
        method: 'POST',
        body: { ...newFact, sourceUrl: null, sourceType: 'manual' },
      }),
    t('brain.factAdded'),
  )
  newFact.text = ''
  newFact.source = ''
  newFactOpen.value = false
}

async function transitionFact(factId: string, status: 'verified' | 'rejected') {
  await run(
    () =>
      $fetch(`${brandApiRoot.value}/facts/${factId}/transition`, {
        method: 'POST',
        body: { status },
      }),
    status === 'verified' ? t('brain.factVerified') : t('brain.factRejected'),
  )
}

async function saveSettings() {
  if (!settings.voice.text.trim()) {
    error.value = t('brain.voiceRequired')
    return
  }
  const body = {
    revision: brain.value!.revision,
    voice: {
      text: settings.voice.text.trim(),
      source: settings.voice.source.trim(),
    },
    audiences: settings.audiences
      .filter((item) => item.name.trim())
      .map((item) => ({ ...item, name: item.name.trim(), description: item.description.trim() })),
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

function addAudience() {
  settings.audiences.push({ name: '', description: '' })
}
function removeAudience(index: number) {
  settings.audiences.splice(index, 1)
}
function addGuardrail() {
  settings.guardrails.push({ text: '', source: t('brain.defaultSource') })
}
function removeGuardrail(index: number) {
  settings.guardrails.splice(index, 1)
}

async function createOffer() {
  if (!offer.name.trim() || !offer.source.trim()) {
    error.value = t('brain.offerRequired')
    return
  }
  if (offer.validUntil && offer.validUntil < offer.validFrom) {
    error.value = t('brain.offerValidUntilInvalid')
    return
  }
  const rawAmount = offer.amount as number | string | null
  const body = {
    ...offer,
    amount: rawAmount === null || rawAmount === '' ? null : Number(rawAmount),
  }
  offerSaving.value = true
  try {
    await run(
      () => $fetch(`${brandApiRoot.value}/offers`, { method: 'POST', body }),
      t('brain.offerCreated'),
    )
  } finally {
    offerSaving.value = false
  }
  offer.name = ''
  offer.description = ''
  offer.amount = null
  offer.validUntil = null
  newOfferOpen.value = false
}

async function activateOffer(offerId: string) {
  await run(
    () => $fetch(`${brandApiRoot.value}/offers/${offerId}/activate`, { method: 'POST', body: {} }),
    t('brain.offerActivated'),
  )
}

async function deactivateOffer(offerId: string) {
  await run(
    () =>
      $fetch(`${brandApiRoot.value}/offers/${offerId}/deactivate`, { method: 'POST', body: {} }),
    t('brain.offerDeactivated'),
  )
}

function startOfferEdit(item: BusinessBrain['offers'][number]) {
  editingOffer.value = item.id
  editOffer.name = item.name
  editOffer.description = item.description
  editOffer.currency = item.currency
  editOffer.amount = item.amount
  editOffer.validFrom = item.validFrom
  editOffer.validUntil = item.validUntil
  editOffer.source = item.source
  editOffer.confidence = item.confidence
}

async function saveOffer(offerId: string) {
  if (!editOffer.name.trim() || !editOffer.source.trim()) {
    error.value = t('brain.offerRequired')
    return
  }
  if (editOffer.validUntil && editOffer.validUntil < editOffer.validFrom) {
    error.value = t('brain.offerValidUntilInvalid')
    return
  }
  const rawAmount = editOffer.amount as number | string | null
  offerSaving.value = true
  try {
    await run(
      () =>
        $fetch(`${brandApiRoot.value}/offers/${offerId}`, {
          method: 'PUT',
          body: {
            ...editOffer,
            amount: rawAmount === null || rawAmount === '' ? null : Number(rawAmount),
          },
        }),
      t('brain.offerUpdated'),
    )
  } finally {
    offerSaving.value = false
  }
  editingOffer.value = null
}

async function deleteOffer(offerId: string) {
  await run(
    () => $fetch(`${brandApiRoot.value}/offers/${offerId}`, { method: 'DELETE', body: {} }),
    t('brain.offerDeleted'),
  )
}

// An offer keeps its row once its window closes: nothing archives it, and a
// seasonal offer is worth reopening next year. Generation already refuses an
// expired offer, so this only stops the list from presenting one as live.
function offerExpired(item: BusinessBrain['offers'][number]) {
  if (!item.validUntil) return false
  return item.validUntil < new Date().toISOString().slice(0, 10)
}

function offerActions(item: BusinessBrain['offers'][number]) {
  const actions = []
  if (item.status === 'draft') {
    actions.push({
      label: t('brain.activate'),
      icon: 'i-lucide-circle-check',
      onSelect: () => activateOffer(item.id),
    })
  } else {
    actions.push({
      label: t('brain.deactivate'),
      icon: 'i-lucide-circle-off',
      onSelect: () => deactivateOffer(item.id),
    })
  }
  actions.push(
    {
      label: t('common.edit'),
      icon: 'i-lucide-pencil',
      onSelect: () => startOfferEdit(item),
    },
    {
      label: t('common.delete'),
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => deleteOffer(item.id),
    },
  )
  return [actions]
}

async function deleteFact(factId: string) {
  await run(
    () => $fetch(`${brandApiRoot.value}/facts/${factId}`, { method: 'DELETE', body: {} }),
    t('brain.factDeleted'),
  )
}

watch([ready, organizationId, brandId], load, { immediate: true })
</script>

<template>
  <UCard class="mt-6" :ui="{ body: 'p-0' }">
    <div class="border-b border-default px-5 py-5 sm:px-7 sm:py-6">
      <h2 class="text-base font-semibold">{{ t('brain.title') }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t('brain.description') }}</p>
    </div>
    <div class="space-y-8 p-5 sm:p-7">
      <div class="space-y-3"></div>
      <div v-if="loading" role="status" class="text-sm text-muted">{{ t('brain.loading') }}</div>
      <template v-else-if="brain">
        <UAccordion
          v-model="expandedBrainSections.facts"
          collapsible
          :items="[{ label: t('brain.facts'), slot: 'facts' }]"
        >
          <template #facts>
            <div class="mt-4 space-y-4">
              <p class="text-sm text-muted">{{ t('brain.factsDescription') }}</p>
              <div class="flex justify-end">
                <UButton
                  type="button"
                  size="sm"
                  variant="outline"
                  icon="i-lucide-plus"
                  @click.prevent.stop="newFactOpen = !newFactOpen"
                  >{{ t('brain.addFact') }}</UButton
                >
              </div>
              <div
                v-if="newFactOpen"
                class="rounded-lg border border-default bg-elevated/20 p-4 space-y-4"
              >
                <div class="grid gap-4 sm:grid-cols-2">
                  <UFormField :label="t('brain.factType')">
                    <USelect
                      v-model="newFact.kind"
                      :items="[
                        { label: t('brain.candidate'), value: 'candidate' },
                        { label: t('brain.explicit'), value: 'explicit' },
                      ]"
                      :aria-label="t('brain.factType')"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField :label="t('brain.factSource')" required>
                    <UInput
                      v-model="newFact.source"
                      :placeholder="t('brain.factSourcePlaceholder')"
                      :aria-label="t('brain.factSource')"
                      class="w-full"
                    />
                  </UFormField>
                </div>
                <UFormField :label="t('brain.factText')" required>
                  <UTextarea
                    v-model="newFact.text"
                    :placeholder="t('brain.factTextPlaceholder')"
                    :aria-label="t('brain.factText')"
                    :rows="3"
                    class="w-full"
                  />
                </UFormField>
                <div class="flex justify-end">
                  <UButton
                    type="button"
                    size="sm"
                    :loading="saving"
                    @click.prevent.stop="createFact"
                    >{{ t('brain.saveFact') }}</UButton
                  >
                </div>
              </div>
              <div
                v-if="!brain.facts.length"
                class="rounded-lg border border-dashed border-default p-4 text-sm text-muted"
              >
                {{ t('brain.noFacts') }}
              </div>
              <div
                v-for="fact in brain.facts"
                :key="fact.id"
                class="space-y-4 rounded-lg border border-default p-4"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge
                    :color="
                      fact.status === 'verified'
                        ? 'success'
                        : fact.status === 'rejected'
                          ? 'error'
                          : 'warning'
                    "
                    variant="subtle"
                    >{{
                      fact.status === 'verified'
                        ? t('brain.statusVerified')
                        : fact.status === 'rejected'
                          ? t('brain.statusRejected')
                          : t('brain.statusProposed')
                    }}</UBadge
                  >
                  <UBadge color="neutral" variant="outline">{{
                    fact.kind === 'candidate' ? t('brain.candidate') : t('brain.explicit')
                  }}</UBadge>
                  <span class="text-xs text-muted">{{
                    t('brain.confidence', { percent: Math.round(fact.confidence * 100) })
                  }}</span>
                </div>
                <div>
                  <template v-if="editingFact === fact.id">
                    <div class="space-y-4">
                      <UFormField :label="t('brain.factText')" required
                        ><UTextarea
                          v-model="editFact.text"
                          :aria-label="t('brain.editFact')"
                          :rows="3"
                          class="w-full"
                      /></UFormField>
                      <UFormField :label="t('brain.source')" required
                        ><UInput
                          v-model="editFact.source"
                          :aria-label="t('brain.editSource')"
                          class="w-full"
                      /></UFormField>
                    </div>
                    <div class="mt-4 flex flex-wrap justify-end gap-2">
                      <UButton
                        type="button"
                        size="sm"
                        :loading="factSaving"
                        @click.prevent.stop="saveFact(fact.id)"
                      >
                        {{ t('common.save') }}
                      </UButton>
                      <UButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        @click.prevent.stop="editingFact = null"
                      >
                        {{ t('common.cancel') }}
                      </UButton>
                    </div>
                  </template>
                  <template v-else>
                    <p class="text-sm leading-relaxed">{{ fact.text }}</p>
                    <p class="text-xs text-muted">
                      {{ t('brain.source') }}: {{ displaySource(fact.source) }}
                    </p>
                    <div class="flex justify-end gap-1">
                      <UButton
                        type="button"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-pencil"
                        :aria-label="`${t('common.edit')} ${fact.text}`"
                        @click.prevent.stop="startFactEdit(fact)"
                      />
                      <UButton
                        type="button"
                        size="xs"
                        color="error"
                        variant="ghost"
                        icon="i-lucide-trash-2"
                        :aria-label="`${t('common.delete')} ${fact.text}`"
                        @click.prevent.stop="deleteFact(fact.id)"
                      />
                      <template v-if="fact.status === 'proposed'">
                        <UButton
                          type="button"
                          size="xs"
                          color="success"
                          variant="ghost"
                          icon="i-lucide-circle-check"
                          :aria-label="t('brain.verify')"
                          @click.prevent.stop="transitionFact(fact.id, 'verified')"
                        />
                        <UButton
                          type="button"
                          size="xs"
                          color="error"
                          variant="ghost"
                          icon="i-lucide-circle-x"
                          :aria-label="t('brain.reject')"
                          @click.prevent.stop="transitionFact(fact.id, 'rejected')"
                        />
                      </template>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </template>
        </UAccordion>

        <UAccordion
          v-model="expandedBrainSections.voice"
          collapsible
          :items="[{ label: t('brain.voice'), slot: 'voice' }]"
          class="border-t border-default pt-6"
        >
          <template #voice>
            <div class="mt-4 space-y-4 pb-2">
              <p class="text-sm text-muted">{{ t('brain.voiceDescription') }}</p>
              <UFormField :label="t('brain.voice')" required>
                <UTextarea
                  v-model="settings.voice.text"
                  :aria-label="t('brain.voice')"
                  :placeholder="t('brain.voicePlaceholder')"
                  :rows="3"
                  class="w-full"
                />
              </UFormField>
              <UFormField :label="t('brain.voiceSource')" required
                ><UInput
                  v-model="settings.voice.source"
                  :aria-label="t('brain.voiceSource')"
                  :placeholder="t('brain.voiceSourcePlaceholder')"
                  class="w-full"
              /></UFormField>
            </div>
          </template>
        </UAccordion>

        <UAccordion
          v-model="expandedBrainSections.audiences"
          collapsible
          :items="[{ label: t('brain.audiences'), slot: 'audiences' }]"
          class="border-t border-default pt-6"
        >
          <template #audiences>
            <div class="mt-4 space-y-4 pb-2">
              <p class="text-sm text-muted">{{ t('brain.audiencesDescription') }}</p>
              <div class="flex justify-end">
                <UButton
                  type="button"
                  size="sm"
                  variant="outline"
                  @click.prevent.stop="addAudience"
                  >{{ t('brain.addAudience') }}</UButton
                >
              </div>
              <div
                v-for="(audience, index) in settings.audiences"
                :key="audience.id || index"
                class="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <UFormField :label="t('brain.audienceName', { index: index + 1 })" required
                  ><UInput
                    v-model="audience.name"
                    :aria-label="t('brain.audienceName', { index: index + 1 })"
                    :placeholder="t('brain.audienceNamePlaceholder')"
                    class="w-full"
                /></UFormField>
                <UFormField :label="t('brain.descriptionLabel')" required
                  ><UInput
                    v-model="audience.description"
                    :aria-label="t('brain.audienceDescription', { index: index + 1 })"
                    :placeholder="t('brain.descriptionLabel')"
                    class="w-full"
                /></UFormField>
                <UButton
                  type="button"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  :aria-label="`${t('common.delete')} ${t('brain.audienceName', { index: index + 1 })}`"
                  @click.prevent.stop="removeAudience(index)"
                />
              </div>
              <p
                v-if="!settings.audiences.length"
                class="rounded-lg border border-dashed border-default p-4 text-sm text-muted"
              >
                {{ t('brain.noAudiences') }}
              </p>
            </div>
          </template>
        </UAccordion>

        <UAccordion
          v-model="expandedBrainSections.offers"
          collapsible
          :items="[{ label: t('brain.offers'), slot: 'offers' }]"
          class="border-t border-default pt-6"
        >
          <template #offers>
            <div class="mt-4 space-y-4 pb-2">
              <p class="text-sm text-muted">{{ t('brain.offersDescription') }}</p>
              <div class="flex justify-end">
                <UButton
                  type="button"
                  size="sm"
                  variant="outline"
                  @click.prevent.stop="newOfferOpen = !newOfferOpen"
                  >{{ t('brain.addOffer') }}</UButton
                >
              </div>
              <div
                v-if="newOfferOpen"
                class="rounded-lg border border-default bg-elevated/20 p-4 space-y-4"
              >
                <div class="grid gap-4 sm:grid-cols-2">
                  <UFormField :label="t('brain.offerName')" required
                    ><UInput
                      v-model="offer.name"
                      :placeholder="t('brain.offerNamePlaceholder')"
                      :aria-label="t('brain.offerName')"
                      class="w-full" /></UFormField
                  ><UFormField :label="t('brain.source')" required
                    ><UInput
                      v-model="offer.source"
                      :placeholder="t('brain.offerSourcePlaceholder')"
                      :aria-label="t('brain.offerSource')"
                      class="w-full"
                  /></UFormField>
                </div>
                <UFormField :label="t('brain.descriptionLabel')" required
                  ><UTextarea
                    v-model="offer.description"
                    :placeholder="t('brain.offerDescriptionPlaceholder')"
                    :aria-label="t('brain.offerDescription')"
                    :rows="3"
                    class="w-full"
                /></UFormField>
                <div class="grid gap-4 sm:grid-cols-4">
                  <UFormField :label="t('brain.currency')"
                    ><USelect
                      v-model="offer.currency"
                      :items="['EUR', 'ALL']"
                      :aria-label="t('brain.currency')"
                      class="w-full" /></UFormField
                  ><UFormField :label="t('brain.price')"
                    ><UInput
                      v-model="offer.amount"
                      type="number"
                      :placeholder="t('brain.optional')"
                      :aria-label="t('brain.price')"
                      class="w-full" /></UFormField
                  ><UFormField :label="t('brain.validFrom')" required
                    ><UInput
                      v-model="offer.validFrom"
                      type="date"
                      class="w-full"
                      :aria-label="t('brain.validFrom')" /></UFormField
                  ><UFormField
                    :label="t('brand.validUntil')"
                    :hint="t('brain.offerValidUntilHint')"
                    ><UInput
                      :model-value="offer.validUntil || ''"
                      type="date"
                      class="w-full"
                      :aria-label="t('brand.validUntil')"
                      @update:model-value="offer.validUntil = ($event as string) || null"
                  /></UFormField>
                </div>
                <div class="flex justify-end">
                  <UButton
                    type="button"
                    size="sm"
                    :loading="offerSaving"
                    @click.prevent.stop="createOffer"
                    >{{ t('brain.saveDraft') }}</UButton
                  >
                </div>
              </div>
              <div
                v-for="item in brain.offers"
                :key="item.id"
                class="rounded-lg border border-default p-4"
              >
                <template v-if="editingOffer === item.id">
                  <div class="space-y-4">
                    <div class="grid gap-4 sm:grid-cols-2">
                      <UFormField :label="t('brain.offerName')">
                        <UInput v-model="editOffer.name" class="w-full" />
                      </UFormField>
                      <UFormField :label="t('brain.source')">
                        <UInput v-model="editOffer.source" class="w-full" />
                      </UFormField>
                    </div>
                    <UFormField :label="t('brain.descriptionLabel')">
                      <UTextarea v-model="editOffer.description" :rows="3" class="w-full" />
                    </UFormField>
                    <div class="grid gap-4 sm:grid-cols-4">
                      <UFormField :label="t('brain.currency')">
                        <USelect
                          v-model="editOffer.currency"
                          :items="['EUR', 'ALL']"
                          class="w-full"
                        />
                      </UFormField>
                      <UFormField :label="t('brain.price')">
                        <UInput v-model="editOffer.amount" type="number" class="w-full" />
                      </UFormField>
                      <UFormField :label="t('brain.validFrom')">
                        <UInput v-model="editOffer.validFrom" type="date" class="w-full" />
                      </UFormField>
                      <UFormField :label="t('brand.validUntil')">
                        <UInput
                          :model-value="editOffer.validUntil || ''"
                          type="date"
                          class="w-full"
                          @update:model-value="editOffer.validUntil = $event || null"
                        />
                      </UFormField>
                    </div>
                    <div class="flex flex-wrap justify-end gap-2">
                      <UButton
                        type="button"
                        size="sm"
                        :loading="offerSaving"
                        @click="saveOffer(item.id)"
                      >
                        {{ t('common.save') }}
                      </UButton>
                      <UButton type="button" size="sm" variant="ghost" @click="editingOffer = null">
                        {{ t('common.cancel') }}
                      </UButton>
                    </div>
                  </div>
                </template>
                <div v-else class="flex flex-wrap items-center justify-between gap-4">
                  <div class="min-w-0">
                    <p class="font-medium">{{ item.name }}</p>
                    <p class="text-sm text-muted">
                      {{ item.description || t('brain.noDescription') }} · {{ item.currency
                      }}{{ item.amount === null ? '' : ` ${item.amount}` }}
                    </p>
                    <p class="text-xs text-muted">
                      {{ item.validFrom }}{{ item.validUntil ? ` – ${item.validUntil}` : '' }} ·
                      {{ displayDefaultSource(item.source) }}
                    </p>
                    <p v-if="offerExpired(item)" class="text-xs text-warning">
                      {{ t('brain.offerExpiredHint') }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <UBadge
                      :color="
                        offerExpired(item)
                          ? 'warning'
                          : item.status === 'active'
                            ? 'success'
                            : 'neutral'
                      "
                      >{{
                        offerExpired(item)
                          ? t('brain.offerExpired')
                          : item.status === 'active'
                            ? t('brain.active')
                            : t('brain.draft')
                      }}</UBadge
                    >
                    <UDropdownMenu :items="offerActions(item)" :content="{ align: 'end' }">
                      <UButton
                        type="button"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-ellipsis"
                        :aria-label="`${t('common.edit')} ${item.name}`"
                      />
                    </UDropdownMenu>
                  </div>
                </div>
              </div>
              <p
                v-if="!brain.offers.length"
                class="rounded-lg border border-dashed border-default p-4 text-sm text-muted"
              >
                {{ t('brain.noOffers') }}
              </p>
            </div>
          </template>
        </UAccordion>

        <UAccordion
          v-model="expandedBrainSections.guardrails"
          collapsible
          :items="[{ label: t('brain.guardrails'), slot: 'guardrails' }]"
          class="border-t border-default pt-6"
        >
          <template #guardrails>
            <div class="mt-4 space-y-4 pb-2">
              <p class="text-sm text-muted">{{ t('brain.guardrailsDescription') }}</p>
              <div class="flex justify-end">
                <UButton
                  type="button"
                  size="sm"
                  variant="outline"
                  @click.prevent.stop="addGuardrail"
                  >{{ t('brain.addRule') }}</UButton
                >
              </div>
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
                  :aria-label="`${t('common.delete')} ${t('brain.rule', { index: index + 1 })}`"
                  @click.prevent.stop="removeGuardrail(index)"
                />
              </div>
              <p
                v-if="!settings.guardrails.length"
                class="rounded-lg border border-dashed border-default p-4 text-sm text-muted"
              >
                {{ t('brain.noGuardrails') }}
              </p>
            </div>
          </template>
        </UAccordion>

        <div class="flex justify-end border-t border-default pt-6">
          <UButton
            type="button"
            class="w-full sm:w-auto"
            :loading="saving"
            :disabled="!settings.voice.text.trim()"
            icon="i-lucide-check"
            @click.prevent.stop="saveSettings"
            >{{ t('brain.save') }}</UButton
          >
        </div>
      </template>
    </div>
  </UCard>
</template>
