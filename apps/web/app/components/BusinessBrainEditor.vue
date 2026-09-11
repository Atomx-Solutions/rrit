<script setup lang="ts">
import type { BusinessBrain, BusinessBrainFact, CreateOffer } from '../../shared/schemas/business-brain'

const route = useRoute()
const { data, canonicalBrand } = useWorkspace()
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
const offer = reactive<CreateOffer>({ name: '', description: '', currency: 'EUR', amount: null, validFrom: new Date().toISOString().slice(0, 10), validUntil: null, source: 'Plotësuar nga biznesi', confidence: 1 })
const settings = reactive({ voice: { text: '', source: 'Plotësuar nga biznesi' }, audiences: [] as Array<{ id?: string; name: string; description: string }>, guardrails: [] as Array<{ id?: string; text: string; source: string }> })

const organizationId = computed(() => String(route.params.org || ''))
const brandId = computed(() => canonicalBrand.value?.id || '')
const brandApiRoot = computed(() => `/api/organizations/${organizationId.value}/brands/${brandId.value}`)
const apiRoot = computed(() => `${brandApiRoot.value}/business-brain`)

function syncSettings(value: BusinessBrain) {
  const activeVoice = value.voiceVersions.find((item) => item.active)
  settings.voice.text = activeVoice?.text || data.value.brand.voice || ''
  settings.voice.source = activeVoice?.source || 'Plotësuar nga biznesi'
  settings.audiences = value.audiences.filter((item) => item.status === 'active').map((item) => ({ id: item.id, name: item.name, description: item.description }))
  settings.guardrails = value.guardrails.filter((item) => item.status === 'active').map((item) => ({ id: item.id, text: item.text, source: item.source }))
}

async function load() {
  if (!organizationId.value || !brandId.value) return
  loading.value = true
  error.value = ''
  try {
    brain.value = await $fetch<BusinessBrain>(apiRoot.value)
    syncSettings(brain.value)
  } catch (cause) {
    error.value = (cause as { data?: { message?: string } }).data?.message || 'Business Brain nuk u ngarkua.'
  } finally {
    loading.value = false
  }
}

async function run<T>(action: () => Promise<T>, success: string) {
  error.value = ''
  message.value = ''
  try { await action(); message.value = success; await load() }
  catch (cause) { error.value = (cause as { data?: { message?: string } }).data?.message || 'Veprimi nuk u krye.' }
}

function startFactEdit(fact: BusinessBrainFact) {
  editingFact.value = fact.id
  editFact.text = fact.text
  editFact.source = fact.source
  editFact.confidence = fact.confidence
}

async function saveFact(factId: string) {
  await run(() => $fetch(`${brandApiRoot.value}/facts/${factId}`, { method: 'PUT', body: { ...editFact, sourceUrl: null } }), 'Fakti u ruajt.')
  editingFact.value = null
}

async function createFact() {
  if (!newFact.text.trim() || !newFact.source.trim()) { error.value = 'Plotëso tekstin dhe burimin e faktit.'; return }
  await run(() => $fetch(`${brandApiRoot.value}/facts`, { method: 'POST', body: { ...newFact, sourceUrl: null, sourceType: 'manual' } }), 'Fakti u shtua.')
  newFact.text = ''; newFact.source = ''; newFactOpen.value = false
}

async function transitionFact(factId: string, status: 'verified' | 'rejected') {
  await run(() => $fetch(`${brandApiRoot.value}/facts/${factId}/transition`, { method: 'POST', body: { status } }), status === 'verified' ? 'Fakti u verifikua.' : 'Fakti u refuzua.')
}

async function saveSettings() {
  if (!settings.voice.text.trim()) { error.value = 'Shkruaj zërin e brandit para ruajtjes.'; return }
  saving.value = true
  try { await run(() => $fetch(apiRoot.value, { method: 'PUT', body: { revision: brain.value!.revision, voice: settings.voice, audiences: settings.audiences, guardrails: settings.guardrails } }), 'Business Brain u ruajt.') }
  finally { saving.value = false }
}

function addAudience() { settings.audiences.push({ name: '', description: '' }) }
function addGuardrail() { settings.guardrails.push({ text: '', source: 'Plotësuar nga biznesi' }) }

async function createOffer() {
  if (!offer.name.trim() || !offer.source.trim()) { error.value = 'Plotëso emrin dhe burimin e ofertës.'; return }
  const rawAmount = offer.amount as number | string | null
  const body = { ...offer, amount: rawAmount === null || rawAmount === '' ? null : Number(rawAmount) }
  await run(() => $fetch(`${brandApiRoot.value}/offers`, { method: 'POST', body }), 'Oferta u ruajt si draft.')
  offer.name = ''; offer.description = ''; newOfferOpen.value = false
}

async function activateOffer(offerId: string) {
  await run(() => $fetch(`${brandApiRoot.value}/offers/${offerId}/activate`, { method: 'POST', body: {} }), 'Oferta u aktivizua.')
}

watch(brandId, load, { immediate: true })
</script>

<template>
  <UCard class="mt-6" :ui="{ body: 'p-0' }">
    <div class="border-b border-default px-5 py-5 sm:px-7 sm:py-6">
      <h2 class="text-base font-semibold">Business Brain</h2>
      <p class="mt-1 text-sm text-muted">Fakte, zëri, audiencat, ofertat dhe rregullat që AI duhet t’i respektojë.</p>
    </div>
    <div class="space-y-8 p-5 sm:p-7">
      <div class="space-y-3">
        <UAlert v-if="error" color="error" variant="outline" :title="error" />
        <UAlert v-if="message" color="success" variant="outline" :title="message" />
      </div>
      <div v-if="loading" role="status" class="text-sm text-muted">Po ngarkohet Business Brain…</div>
      <template v-else-if="brain">
        <section class="space-y-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold">Faktet</h3>
              <p class="text-sm text-muted">Faktet e propozuara duhet të verifikohen ose refuzohen.</p>
            </div>
            <UButton type="button" size="sm" variant="outline" icon="i-lucide-plus" @click.prevent.stop="newFactOpen = !newFactOpen">Shto fakt</UButton>
          </div>
          <div v-if="newFactOpen" class="rounded-lg border border-default bg-elevated/20 p-4 space-y-4">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Lloji i faktit">
                <USelect v-model="newFact.kind" :items="[{ label: 'Kandidat', value: 'candidate' }, { label: 'Explicit', value: 'explicit' }]" aria-label="Lloji i faktit" class="w-full" />
              </UFormField>
              <UFormField label="Burimi i faktit">
                <UInput v-model="newFact.source" placeholder="P.sh. Dokument i biznesit" aria-label="Burimi i faktit" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Teksti i faktit">
              <UTextarea v-model="newFact.text" placeholder="Shkruaj një fakt që AI mund ta përdorë." aria-label="Teksti i faktit" :rows="3" class="w-full" />
            </UFormField>
            <div class="flex justify-end">
              <UButton type="button" size="sm" :loading="saving" @click.prevent.stop="createFact">Ruaj faktin</UButton>
            </div>
          </div>
          <div v-if="!brain.facts.length" class="rounded-lg border border-dashed border-default p-4 text-sm text-muted">Nuk ka fakte ende.</div>
          <div v-for="fact in brain.facts" :key="fact.id" class="rounded-lg border border-default p-4 space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge :color="fact.status === 'verified' ? 'success' : fact.status === 'rejected' ? 'error' : 'warning'" variant="subtle">{{ fact.status === 'verified' ? 'VERIFIED' : fact.status === 'rejected' ? 'REJECTED' : 'PROPOSED' }}</UBadge>
              <UBadge color="neutral" variant="outline">{{ fact.kind === 'candidate' ? 'Kandidat' : 'Explicit' }}</UBadge>
              <span class="text-xs text-muted">Besimi: {{ Math.round(fact.confidence * 100) }}%</span>
            </div>
            <template v-if="editingFact === fact.id">
              <div class="space-y-4">
                <UFormField label="Teksti i faktit"><UTextarea v-model="editFact.text" aria-label="Ndrysho faktin" :rows="3" class="w-full" /></UFormField>
                <UFormField label="Burimi"><UInput v-model="editFact.source" aria-label="Ndrysho burimin" class="w-full" /></UFormField>
              </div>
                <div class="flex flex-wrap justify-end gap-2"><UButton type="button" size="sm" @click.prevent.stop="saveFact(fact.id)">Ruaj</UButton><UButton type="button" size="sm" variant="ghost" @click.prevent.stop="editingFact = null">Anulo</UButton></div>
            </template>
            <template v-else>
              <p class="text-sm leading-relaxed">{{ fact.text }}</p>
              <p class="text-xs text-muted">Burimi: {{ fact.source }}</p>
              <div class="flex flex-wrap gap-2">
                <UButton v-if="fact.kind === 'explicit' && fact.status !== 'rejected'" type="button" size="xs" variant="outline" @click.prevent.stop="startFactEdit(fact)">Ndrysho</UButton>
                <UButton v-if="fact.status === 'proposed'" type="button" size="xs" color="success" variant="outline" @click.prevent.stop="transitionFact(fact.id, 'verified')">Verifiko</UButton>
                <UButton v-if="fact.status === 'proposed'" type="button" size="xs" color="error" variant="outline" @click.prevent.stop="transitionFact(fact.id, 'rejected')">Refuzo</UButton>
              </div>
            </template>
          </div>
        </section>

        <section class="space-y-4 border-t border-default pt-8">
          <div><h3 class="font-semibold">Zëri i brandit</h3><p class="text-sm text-muted">Çdo ruajtje krijon version të ri.</p></div>
          <UFormField label="Zëri i brandit">
            <UTextarea v-model="settings.voice.text" aria-label="Zëri i brandit" placeholder="P.sh. Informativ dhe miqësor" :rows="3" class="w-full" />
          </UFormField>
          <UFormField label="Burimi i zërit"><UInput v-model="settings.voice.source" aria-label="Burimi i zërit" placeholder="P.sh. Plotësuar nga biznesi" class="w-full" /></UFormField>
        </section>

        <section class="space-y-4 border-t border-default pt-8">
          <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="font-semibold">Audiencat</h3><p class="text-sm text-muted">Përcakto kujt i drejtohet biznesi.</p></div><UButton type="button" size="sm" variant="outline" @click.prevent.stop="addAudience">Shto audiencë</UButton></div>
          <div v-for="(audience, index) in settings.audiences" :key="audience.id || index" class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="`Emri i audiencës ${index + 1}`"><UInput v-model="audience.name" :aria-label="`Emri i audiencës ${index + 1}`" placeholder="P.sh. Pronarë të veturave" class="w-full" /></UFormField>
            <UFormField label="Përshkrimi"><UInput v-model="audience.description" :aria-label="`Përshkrimi i audiencës ${index + 1}`" placeholder="Përshkrimi" class="w-full" /></UFormField>
          </div>
          <p v-if="!settings.audiences.length" class="rounded-lg border border-dashed border-default p-4 text-sm text-muted">Nuk ka audienca të strukturuara ende.</p>
        </section>

        <section class="space-y-4 border-t border-default pt-8">
          <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="font-semibold">Ofertat</h3><p class="text-sm text-muted">Vetëm ofertat aktive dhe valide mund të përdoren si oferta aktuale.</p></div><UButton type="button" size="sm" variant="outline" @click.prevent.stop="newOfferOpen = !newOfferOpen">Shto ofertë</UButton></div>
          <div v-if="newOfferOpen" class="rounded-lg border border-default bg-elevated/20 p-4 space-y-4">
            <div class="grid gap-4 sm:grid-cols-2"><UFormField label="Emri i ofertës"><UInput v-model="offer.name" placeholder="P.sh. Kontroll falas" aria-label="Emri i ofertës" class="w-full" /></UFormField><UFormField label="Burimi"><UInput v-model="offer.source" placeholder="P.sh. Lista e çmimeve" aria-label="Burimi i ofertës" class="w-full" /></UFormField></div>
            <UFormField label="Përshkrimi"><UTextarea v-model="offer.description" placeholder="Përshkrimi i ofertës" aria-label="Përshkrimi i ofertës" :rows="3" class="w-full" /></UFormField>
            <div class="grid gap-4 sm:grid-cols-3"><UFormField label="Monedha"><USelect v-model="offer.currency" :items="['EUR', 'ALL']" aria-label="Monedha" class="w-full" /></UFormField><UFormField label="Çmimi"><UInput v-model="offer.amount" type="number" placeholder="Opsionale" aria-label="Çmimi" class="w-full" /></UFormField><UFormField label="E vlefshme nga"><UInput v-model="offer.validFrom" type="date" aria-label="E vlefshme nga" class="w-full" /></UFormField></div>
            <div class="flex justify-end"><UButton type="button" size="sm" @click.prevent.stop="createOffer">Ruaj si draft</UButton></div>
          </div>
          <div v-for="item in brain.offers" :key="item.id" class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-default p-4">
            <div class="min-w-0"><p class="font-medium">{{ item.name }}</p><p class="text-sm text-muted">{{ item.description || 'Pa përshkrim' }} · {{ item.currency }}{{ item.amount === null ? '' : ` ${item.amount}` }}</p><p class="text-xs text-muted">{{ item.validFrom }}{{ item.validUntil ? ` – ${item.validUntil}` : '' }} · {{ item.source }}</p></div>
            <div class="flex items-center gap-2"><UBadge :color="item.status === 'active' ? 'success' : 'neutral'">{{ item.status }}</UBadge><UButton v-if="item.status === 'draft'" type="button" size="xs" color="success" variant="outline" @click.prevent.stop="activateOffer(item.id)">Aktivizo</UButton></div>
          </div>
          <p v-if="!brain.offers.length" class="rounded-lg border border-dashed border-default p-4 text-sm text-muted">Nuk ka oferta ende.</p>
        </section>

        <section class="space-y-4 border-t border-default pt-8">
          <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="font-semibold">Guardrails</h3><p class="text-sm text-muted">Rregulla që përmbajtja nuk duhet t’i shkelë.</p></div><UButton type="button" size="sm" variant="outline" @click.prevent.stop="addGuardrail">Shto rregull</UButton></div>
          <div v-for="(guardrail, index) in settings.guardrails" :key="guardrail.id || index" class="grid gap-4 sm:grid-cols-2"><UFormField :label="`Rregulli ${index + 1}`"><UInput v-model="guardrail.text" :aria-label="`Guardrail ${index + 1}`" placeholder="P.sh. Mos premto rezultate të garantuara" class="w-full" /></UFormField><UFormField label="Burimi"><UInput v-model="guardrail.source" :aria-label="`Burimi i guardrail ${index + 1}`" placeholder="P.sh. Politika e biznesit" class="w-full" /></UFormField></div>
          <p v-if="!settings.guardrails.length" class="rounded-lg border border-dashed border-default p-4 text-sm text-muted">Nuk ka guardrails ende.</p>
        </section>

        <div class="flex justify-end border-t border-default pt-6"><UButton type="button" class="w-full sm:w-auto" :loading="saving" :disabled="!settings.voice.text.trim()" icon="i-lucide-check" @click.prevent.stop="saveSettings">Ruaj Business Brain</UButton></div>
      </template>
    </div>
  </UCard>
</template>
