<script setup lang="ts">
import { updateBrainSchema, type BusinessBrain, type BusinessBrainFact, type CreateOffer } from '../../shared/schemas/business-brain'

const route = useRoute()
const { t } = useI18n()
const { data, canonicalBrand, ready } = useWorkspace()
const brain = ref<BusinessBrain | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
const editingFact = ref<string | null>(null)
const editFact = reactive({ text: '', source: '', confidence: 1 })
const newFactOpen = ref(false)
const newFact = reactive({ kind: 'candidate' as 'candidate' | 'explicit', text: '', source: '', confidence: 1 })
const newOfferOpen = ref(false)
const offer = reactive<CreateOffer>({ name: '', description: '', currency: 'EUR', amount: null, validFrom: new Date().toISOString().slice(0, 10), validUntil: null, source: t('brain.defaultSource'), confidence: 1 })
const settings = reactive({ voice: { text: '', source: t('brain.defaultSource') }, audiences: [] as Array<{ id?: string; name: string; description: string }>, guardrails: [] as Array<{ id?: string; text: string; source: string }> })

const organizationId = computed(() => String(route.params.org || ''))
const brandId = computed(() => canonicalBrand.value?.id || '')
const brandApiRoot = computed(() => `/api/organizations/${organizationId.value}/brands/${brandId.value}`)
const apiRoot = computed(() => `${brandApiRoot.value}/business-brain`)
function displaySource(source: string) {
  return source === 'Informacion i dhënë nga pronari i biznesit'
    ? t('brain.businessOwnerSource')
    : source
}

function syncSettings(value: BusinessBrain) {
  const activeVoice = value.voiceVersions.find((item) => item.active)
  settings.voice.text = activeVoice?.text || data.value.brand.voice || ''
  settings.voice.source = activeVoice?.source || t('brain.defaultSource')
  settings.audiences = value.audiences.filter((item) => item.status === 'active').map((item) => ({ id: item.id, name: item.name, description: item.description }))
  settings.guardrails = value.guardrails.filter((item) => item.status === 'active').map((item) => ({ id: item.id, text: item.text, source: item.source }))
}

async function load() {
  if (!ready.value || !organizationId.value) return
  if (!brandId.value) {
    brain.value = null
    error.value = t('brain.brandUnavailable')
    return
  }
  loading.value = true
  error.value = ''
  try {
    brain.value = await $fetch<BusinessBrain>(apiRoot.value)
    syncSettings(brain.value)
  } catch (cause) {
    error.value = (cause as { data?: { message?: string } }).data?.message || t('brain.loadError')
  } finally {
    loading.value = false
  }
}

async function run<T>(action: () => Promise<T>, success: string) {
  error.value = ''
  message.value = ''
  try { await action(); message.value = success; await load() }
  catch (cause) { error.value = (cause as { data?: { message?: string } }).data?.message || t('brain.actionError') }
}

function startFactEdit(fact: BusinessBrainFact) {
  editingFact.value = fact.id
  editFact.text = fact.text
  editFact.source = fact.source
  editFact.confidence = fact.confidence
}

async function saveFact(factId: string) {
  await run(() => $fetch(`${brandApiRoot.value}/facts/${factId}`, { method: 'PUT', body: { ...editFact, sourceUrl: null } }), t('brain.factSaved'))
  editingFact.value = null
}

async function createFact() {
  if (!newFact.text.trim() || !newFact.source.trim()) { error.value = t('brain.factRequired'); return }
  await run(() => $fetch(`${brandApiRoot.value}/facts`, { method: 'POST', body: { ...newFact, sourceUrl: null, sourceType: 'manual' } }), t('brain.factAdded'))
  newFact.text = ''; newFact.source = ''; newFactOpen.value = false
}

async function transitionFact(factId: string, status: 'verified' | 'rejected') {
  await run(() => $fetch(`${brandApiRoot.value}/facts/${factId}/transition`, { method: 'POST', body: { status } }), status === 'verified' ? t('brain.factVerified') : t('brain.factRejected'))
}

async function saveSettings() {
  if (!settings.voice.text.trim()) { error.value = t('brain.voiceRequired'); return }
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
  try { await run(() => $fetch(apiRoot.value, { method: 'PUT', body: parsed.data }), t('brain.saved')) }
  finally { saving.value = false }
}

function addAudience() { settings.audiences.push({ name: '', description: '' }) }
function addGuardrail() { settings.guardrails.push({ text: '', source: t('brain.defaultSource') }) }

async function createOffer() {
  if (!offer.name.trim() || !offer.source.trim()) { error.value = t('brain.offerRequired'); return }
  const rawAmount = offer.amount as number | string | null
  const body = { ...offer, amount: rawAmount === null || rawAmount === '' ? null : Number(rawAmount) }
  await run(() => $fetch(`${brandApiRoot.value}/offers`, { method: 'POST', body }), t('brain.offerSaved'))
  offer.name = ''; offer.description = ''; newOfferOpen.value = false
}

async function activateOffer(offerId: string) {
  await run(() => $fetch(`${brandApiRoot.value}/offers/${offerId}/activate`, { method: 'POST', body: {} }), t('brain.offerActivated'))
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
      <div class="space-y-3">
        <UAlert v-if="error" color="error" variant="outline" :title="error" />
        <UAlert v-if="message" color="success" variant="outline" :title="message" />
      </div>
      <div v-if="loading" role="status" class="text-sm text-muted">{{ t('brain.loading') }}</div>
      <template v-else-if="brain">
        <section class="space-y-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold">{{ t('brain.facts') }}</h3>
              <p class="text-sm text-muted">{{ t('brain.factsDescription') }}</p>
            </div>
            <UButton type="button" size="sm" variant="outline" icon="i-lucide-plus" @click.prevent.stop="newFactOpen = !newFactOpen">{{ t('brain.addFact') }}</UButton>
          </div>
          <div v-if="newFactOpen" class="rounded-lg border border-default bg-elevated/20 p-4 space-y-4">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField :label="t('brain.factType')">
                <USelect v-model="newFact.kind" :items="[{ label: t('brain.candidate'), value: 'candidate' }, { label: t('brain.explicit'), value: 'explicit' }]" :aria-label="t('brain.factType')" class="w-full" />
              </UFormField>
              <UFormField :label="t('brain.factSource')">
                <UInput v-model="newFact.source" :placeholder="t('brain.factSourcePlaceholder')" :aria-label="t('brain.factSource')" class="w-full" />
              </UFormField>
            </div>
            <UFormField :label="t('brain.factText')">
              <UTextarea v-model="newFact.text" :placeholder="t('brain.factTextPlaceholder')" :aria-label="t('brain.factText')" :rows="3" class="w-full" />
            </UFormField>
            <div class="flex justify-end">
              <UButton type="button" size="sm" :loading="saving" @click.prevent.stop="createFact">{{ t('brain.saveFact') }}</UButton>
            </div>
          </div>
          <div v-if="!brain.facts.length" class="rounded-lg border border-dashed border-default p-4 text-sm text-muted">{{ t('brain.noFacts') }}</div>
          <div v-for="fact in brain.facts" :key="fact.id" class="rounded-lg border border-default p-4 space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge :color="fact.status === 'verified' ? 'success' : fact.status === 'rejected' ? 'error' : 'warning'" variant="subtle">{{ fact.status === 'verified' ? t('brain.statusVerified') : fact.status === 'rejected' ? t('brain.statusRejected') : t('brain.statusProposed') }}</UBadge>
              <UBadge color="neutral" variant="outline">{{ fact.kind === 'candidate' ? t('brain.candidate') : t('brain.explicit') }}</UBadge>
              <span class="text-xs text-muted">{{ t('brain.confidence', { percent: Math.round(fact.confidence * 100) }) }}</span>
            </div>
            <template v-if="editingFact === fact.id">
              <div class="space-y-4">
                <UFormField :label="t('brain.factText')"><UTextarea v-model="editFact.text" :aria-label="t('brain.editFact')" :rows="3" class="w-full" /></UFormField>
                <UFormField :label="t('brain.source')"><UInput v-model="editFact.source" :aria-label="t('brain.editSource')" class="w-full" /></UFormField>
              </div>
                <div class="flex flex-wrap justify-end gap-2"><UButton type="button" size="sm" @click.prevent.stop="saveFact(fact.id)">{{ t('common.save') }}</UButton><UButton type="button" size="sm" variant="ghost" @click.prevent.stop="editingFact = null">{{ t('common.cancel') }}</UButton></div>
            </template>
            <template v-else>
              <p class="text-sm leading-relaxed">{{ fact.text }}</p>
              <p class="text-xs text-muted">{{ t('brain.source') }}: {{ displaySource(fact.source) }}</p>
              <div class="flex flex-wrap gap-2">
                <UButton v-if="fact.kind === 'explicit' && fact.status !== 'rejected'" type="button" size="xs" variant="outline" @click.prevent.stop="startFactEdit(fact)">{{ t('common.edit') }}</UButton>
                <UButton v-if="fact.status === 'proposed'" type="button" size="xs" color="success" variant="outline" @click.prevent.stop="transitionFact(fact.id, 'verified')">{{ t('brain.verify') }}</UButton>
                <UButton v-if="fact.status === 'proposed'" type="button" size="xs" color="error" variant="outline" @click.prevent.stop="transitionFact(fact.id, 'rejected')">{{ t('brain.reject') }}</UButton>
              </div>
            </template>
          </div>
        </section>

        <section class="space-y-4 border-t border-default pt-8">
          <div><h3 class="font-semibold">{{ t('brain.voice') }}</h3><p class="text-sm text-muted">{{ t('brain.voiceDescription') }}</p></div>
          <UFormField :label="t('brain.voice')">
            <UTextarea v-model="settings.voice.text" :aria-label="t('brain.voice')" :placeholder="t('brain.voicePlaceholder')" :rows="3" class="w-full" />
          </UFormField>
          <UFormField :label="t('brain.voiceSource')"><UInput v-model="settings.voice.source" :aria-label="t('brain.voiceSource')" :placeholder="t('brain.voiceSourcePlaceholder')" class="w-full" /></UFormField>
        </section>

        <section class="space-y-4 border-t border-default pt-8">
          <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="font-semibold">{{ t('brain.audiences') }}</h3><p class="text-sm text-muted">{{ t('brain.audiencesDescription') }}</p></div><UButton type="button" size="sm" variant="outline" @click.prevent.stop="addAudience">{{ t('brain.addAudience') }}</UButton></div>
          <div v-for="(audience, index) in settings.audiences" :key="audience.id || index" class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="t('brain.audienceName', { index: index + 1 })"><UInput v-model="audience.name" :aria-label="t('brain.audienceName', { index: index + 1 })" :placeholder="t('brain.audienceNamePlaceholder')" class="w-full" /></UFormField>
            <UFormField :label="t('brain.descriptionLabel')"><UInput v-model="audience.description" :aria-label="t('brain.audienceDescription', { index: index + 1 })" :placeholder="t('brain.descriptionLabel')" class="w-full" /></UFormField>
          </div>
          <p v-if="!settings.audiences.length" class="rounded-lg border border-dashed border-default p-4 text-sm text-muted">{{ t('brain.noAudiences') }}</p>
        </section>

        <section class="space-y-4 border-t border-default pt-8">
          <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="font-semibold">{{ t('brain.offers') }}</h3><p class="text-sm text-muted">{{ t('brain.offersDescription') }}</p></div><UButton type="button" size="sm" variant="outline" @click.prevent.stop="newOfferOpen = !newOfferOpen">{{ t('brain.addOffer') }}</UButton></div>
          <div v-if="newOfferOpen" class="rounded-lg border border-default bg-elevated/20 p-4 space-y-4">
            <div class="grid gap-4 sm:grid-cols-2"><UFormField :label="t('brain.offerName')"><UInput v-model="offer.name" :placeholder="t('brain.offerNamePlaceholder')" :aria-label="t('brain.offerName')" class="w-full" /></UFormField><UFormField :label="t('brain.source')"><UInput v-model="offer.source" :placeholder="t('brain.offerSourcePlaceholder')" :aria-label="t('brain.offerSource')" class="w-full" /></UFormField></div>
            <UFormField :label="t('brain.descriptionLabel')"><UTextarea v-model="offer.description" :placeholder="t('brain.offerDescriptionPlaceholder')" :aria-label="t('brain.offerDescription')" :rows="3" class="w-full" /></UFormField>
            <div class="grid gap-4 sm:grid-cols-3"><UFormField :label="t('brain.currency')"><USelect v-model="offer.currency" :items="['EUR', 'ALL']" :aria-label="t('brain.currency')" class="w-full" /></UFormField><UFormField :label="t('brain.price')"><UInput v-model="offer.amount" type="number" :placeholder="t('brain.optional')" :aria-label="t('brain.price')" class="w-full" /></UFormField><UFormField :label="t('brain.validFrom')"><UInput v-model="offer.validFrom" type="date" :aria-label="t('brain.validFrom')" /></UFormField></div>
            <div class="flex justify-end"><UButton type="button" size="sm" @click.prevent.stop="createOffer">{{ t('brain.saveDraft') }}</UButton></div>
          </div>
          <div v-for="item in brain.offers" :key="item.id" class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-default p-4">
            <div class="min-w-0"><p class="font-medium">{{ item.name }}</p><p class="text-sm text-muted">{{ item.description || t('brain.noDescription') }} · {{ item.currency }}{{ item.amount === null ? '' : ` ${item.amount}` }}</p><p class="text-xs text-muted">{{ item.validFrom }}{{ item.validUntil ? ` – ${item.validUntil}` : '' }} · {{ item.source }}</p></div>
            <div class="flex items-center gap-2"><UBadge :color="item.status === 'active' ? 'success' : 'neutral'">{{ item.status === 'active' ? t('brain.active') : t('brain.draft') }}</UBadge><UButton v-if="item.status === 'draft'" type="button" size="xs" color="success" variant="outline" @click.prevent.stop="activateOffer(item.id)">{{ t('brain.activate') }}</UButton></div>
          </div>
          <p v-if="!brain.offers.length" class="rounded-lg border border-dashed border-default p-4 text-sm text-muted">{{ t('brain.noOffers') }}</p>
        </section>

        <section class="space-y-4 border-t border-default pt-8">
          <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="font-semibold">{{ t('brain.guardrails') }}</h3><p class="text-sm text-muted">{{ t('brain.guardrailsDescription') }}</p></div><UButton type="button" size="sm" variant="outline" @click.prevent.stop="addGuardrail">{{ t('brain.addRule') }}</UButton></div>
          <div v-for="(guardrail, index) in settings.guardrails" :key="guardrail.id || index" class="grid gap-4 sm:grid-cols-2"><UFormField :label="t('brain.rule', { index: index + 1 })"><UInput v-model="guardrail.text" :aria-label="t('brain.rule', { index: index + 1 })" :placeholder="t('brain.rulePlaceholder')" class="w-full" /></UFormField><UFormField :label="t('brain.source')"><UInput v-model="guardrail.source" :aria-label="t('brain.source')" :placeholder="t('brain.sourcePlaceholder')" class="w-full" /></UFormField></div>
           <p v-if="!settings.guardrails.length" class="rounded-lg border border-dashed border-default p-4 text-sm text-muted">{{ t('brain.noGuardrails') }}</p>
        </section>

        <div class="flex justify-end border-t border-default pt-6"><UButton type="button" class="w-full sm:w-auto" :loading="saving" :disabled="!settings.voice.text.trim()" icon="i-lucide-check" @click.prevent.stop="saveSettings">{{ t('brain.save') }}</UButton></div>
      </template>
    </div>
  </UCard>
</template>
