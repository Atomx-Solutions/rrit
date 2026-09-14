<script setup lang="ts">
import { z } from 'zod'
import { factInputProblem, type BrandFact } from '~~/shared/schemas/business-brain'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Biznesi im · Rrit' })
const { data, base, syncing, commit, notify } = useWorkspace()
const { form, clear, recovered, localError } = useDraft(
  `${base.value}:brand`,
  structuredClone(toRaw(data.value.brand)),
)
const baseline = ref(JSON.stringify(form))
const saved = ref(false)
const formError = ref('')
const dirty = computed(() => JSON.stringify(form) !== baseline.value)
const leaveOpen = ref(false)
let resolveLeave: ((allow: boolean) => void) | undefined
const schema = z.object({
  name: z.string().min(2, 'Vendos emrin e biznesit.'),
  city: z.string().min(2, 'Vendos qytetin.'),
  description: z.string().min(10, 'Trego shkurt çfarë ofron biznesi.'),
  voice: z.string(),
  audience: z.string(),
  industry: z.string().max(200),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Zgjidh një ngjyrë valide.'),
  facebookUrl: z
    .string()
    .refine((value) => !value || URL.canParse(value), 'Vendos një URL valide.'),
  instagramUrl: z
    .string()
    .refine((value) => !value || URL.canParse(value), 'Vendos një URL valide.'),
  goals: z
    .array(z.string().trim().min(2, 'Qëllimi duhet të ketë të paktën 2 karaktere.').max(120))
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
    notify('Burimet për hulumtim duhet të jenë URL HTTPS pa kredenciale.')
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
    notify('Identiteti i biznesit u ruajt')
  } else {
    formError.value = 'Ndryshimet nuk u ruajtën. Kontrollo gabimin ose ngarko versionin e fundit.'
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
    source: 'Plotësuar nga biznesi',
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
  fact.currency = fact.amountCents == null ? null : 'EUR'
  invalidateFact(fact)
}
</script>
<template>
  <DashboardPage
    title="Biznesi im"
    description="Sa më mirë ta njohim biznesin, aq më natyrshëm mund të flasin postimet për të."
  >
    <UAlert v-if="localError" color="warning" variant="outline" :title="localError" />
    <UAlert v-else-if="formError" color="error" variant="outline" :title="formError" />
    <UAlert
      v-else-if="recovered"
      color="neutral"
      variant="outline"
      icon="i-lucide-history"
      title="Vazhdo aty ku e le"
      description="I rikthyem shënimet e fundit. Kliko Ruaj identitetin për t’i përdorur në profilin e biznesit."
    />
    <div class="grid xl:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start max-w-6xl">
      <UCard :ui="{ body: 'p-5 sm:p-7' }"
        ><UForm :schema="schema" :state="form" class="space-y-6" @submit="save"
          ><div class="flex gap-3 items-center mb-2">
            <UAvatar icon="i-lucide-store" size="md" />
            <h2 class="text-base font-semibold">Profili i biznesit</h2>
          </div>
          <UFormField label="Emri i biznesit" name="name" required
            ><UInput v-model="form.name" class="w-full" maxlength="120"
          /></UFormField>
          <div class="grid sm:grid-cols-2 gap-5">
            <UFormField label="Qyteti" name="city" required
              ><UInput
                v-model="form.city"
                class="w-full"
                placeholder="P.sh. Prishtinë" /></UFormField
            ><UFormField label="Lloji i biznesit" name="industry"
              ><UInput v-model="form.industry" class="w-full" placeholder="P.sh. Kafene"
            /></UFormField>
          </div>
          <UFormField
            label="Çfarë ofron për klientët?"
            name="description"
            description="Produktet, shërbimet dhe detajet që të dallojnë."
            required
            ><UTextarea
              v-model="form.description"
              :rows="4"
              maxlength="2000"
              class="w-full" /></UFormField
          ><UFormField label="Si dëshiron të flasësh në postime?" name="voice"
            ><UTextarea
              v-model="form.voice"
              :rows="2"
              maxlength="1000"
              class="w-full"
              placeholder="P.sh. Thjesht, ngrohtë dhe miqësisht." /></UFormField
          ><UFormField label="Për kë janë produktet ose shërbimet e tua?" name="audience"
            ><UTextarea
              v-model="form.audience"
              :rows="2"
              maxlength="1000"
              class="w-full"
              placeholder="P.sh. Njerëzit e lagjes dhe ata që punojnë afër nesh."
          /></UFormField>
          <div class="grid sm:grid-cols-2 gap-5">
            <UFormField label="Ngjyra e brandit" name="color"
              ><UInput v-model="form.color" type="color" class="w-full h-10" /></UFormField
            ><UFormField label="Statusi" name="status"
              ><USelect
                v-model="form.status"
                :items="[
                  { label: 'Aktiv', value: 'active' },
                  { label: 'I arkivuar', value: 'archived' },
                ]"
            /></UFormField>
          </div>
          <UFormField
            label="Lidhjet sociale"
            description="Opsionale; mund t'i shtosh edhe më vonë."
          >
            <div class="grid sm:grid-cols-2 gap-5">
              <UFormField name="facebookUrl">
                <UInput
                  v-model="form.facebookUrl"
                  aria-label="Facebook URL"
                  placeholder="https://facebook.com/..."
                />
              </UFormField>
              <UFormField name="instagramUrl">
                <UInput
                  v-model="form.instagramUrl"
                  aria-label="Instagram URL"
                  placeholder="https://instagram.com/..."
                />
              </UFormField>
            </div>
          </UFormField>
          <div class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold">Qëllimet e biznesit</h3>
              <p class="text-sm text-muted">Përdori për ta orientuar përmbajtjen dhe sugjerimet.</p>
            </div>
            <div v-for="(_, i) in form.goals" :key="i" class="flex gap-2">
              <UInput
                v-model="form.goals[i]"
                class="w-full"
                placeholder="P.sh. Gjej klientë të rinj"
              />
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                :aria-label="`Hiq qëllimin ${i + 1}`"
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
              Shto qëllim
            </UButton>
          </div>
          <UAccordion
            :items="[{ label: 'Detaje që postimet duhet t’i kenë të sakta', slot: 'facts' }]"
            ><template #facts
              ><div class="space-y-4 pb-4">
                <p class="text-sm text-muted leading-relaxed">
                  Orari, adresa, çmimet ose shërbimet. Shëno edhe nga vjen informacioni. Nëse
                  ndryshon një fakt të konfirmuar, ruaje fillimisht dhe pastaj rikonfirmoje.
                </p>
                <UCard
                  v-for="(fact, i) in form.facts"
                  :key="fact.id"
                  variant="outline"
                  :ui="{ body: 'p-4 space-y-3' }"
                  ><UFormField :label="`Detaji ${i + 1}`"
                    ><UTextarea
                      v-model="fact.text"
                      class="w-full"
                      :rows="2"
                      maxlength="1000"
                      @update:model-value="invalidateFact(fact)" /></UFormField
                  ><UFormField label="Burimi"
                    ><UInput
                      v-model="fact.source"
                      class="w-full"
                      maxlength="500"
                      @update:model-value="invalidateFact(fact)"
                  /></UFormField>
                  <div class="grid sm:grid-cols-3 gap-3">
                    <UFormField label="Lloji">
                      <USelect
                        :model-value="fact.kind || 'fact'"
                        :items="[
                          { label: 'Fakt', value: 'fact' },
                          { label: 'Ofertë', value: 'offer' },
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
                    <UFormField label="Vlen nga">
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
                    <UFormField label="Vlen deri">
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
                    label="Çmimi në EUR (opsional)"
                    description="Datat janë të detyrueshme për ofertat e konfirmuara."
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
                    Versioni {{ fact.revision }} ·
                    {{ fact.verified ? 'Konfirmuar nga biznesi' : 'Pret konfirmim' }}
                  </p>
                  <div class="flex items-center justify-between gap-3">
                    <UCheckbox
                      v-model="fact.verified"
                      label="E kam kontrolluar këtë informacion"
                    /><UButton
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      :aria-label="`Hiq detajin ${i + 1}`"
                      @click="form.facts.splice(i, 1)"
                    /></div></UCard
                ><UButton color="neutral" variant="outline" icon="i-lucide-plus" @click="addFact"
                  >Shto një detaj</UButton
                >
              </div></template
            ></UAccordion
          >
          <UAccordion :items="[{ label: 'Burime për hulumtim', slot: 'sources' }]">
            <template #sources>
              <div class="space-y-3 pb-4">
                <p class="text-sm text-muted leading-relaxed">
                  Shto faqen zyrtare, menunë, katalogun ose burime të tjera që dëshiron t’i
                  kontrollojë fillimisht hulumtimi mujor. Këto janë pista, jo fakte të konfirmuara;
                  çdo pretendim vazhdon të kërkojë kontrollin tënd.
                </p>
                <div v-for="(_, i) in form.researchSources || []" :key="i" class="flex gap-2">
                  <UInput
                    v-model="form.researchSources![i]"
                    type="url"
                    inputmode="url"
                    maxlength="500"
                    placeholder="https://biznesi-yt.com/menu"
                    :aria-label="`Burimi ${i + 1}`"
                    class="flex-1"
                  />
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    :aria-label="`Hiq burimin ${i + 1}`"
                    @click="form.researchSources!.splice(i, 1)"
                  />
                </div>
                <UButton
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-plus"
                  :disabled="(form.researchSources?.length || 0) >= 10"
                  @click="addResearchSource"
                  >Shto burim</UButton
                >
              </div>
            </template>
          </UAccordion>
          <UAccordion :items="[{ label: 'Udhëzime dhe kufij për AI', slot: 'guardrails' }]">
            <template #guardrails>
              <div class="space-y-3 pb-4">
                <p class="text-sm text-muted">
                  P.sh. mos përdor krahasime me konkurrentët ose premtime për rezultate.
                </p>
                <div v-for="(_, i) in form.guardrails || []" :key="i" class="flex gap-2">
                  <UInput
                    v-model="form.guardrails![i]"
                    :aria-label="`Udhëzimi ${i + 1}`"
                    maxlength="500"
                    class="flex-1"
                  />
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    :aria-label="`Hiq udhëzimin ${i + 1}`"
                    @click="form.guardrails!.splice(i, 1)"
                  />
                </div>
                <UButton
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-plus"
                  :disabled="(form.guardrails?.length || 0) >= 20"
                  @click="(form.guardrails ||= []).push('')"
                  >Shto udhëzim</UButton
                >
              </div>
            </template>
          </UAccordion>
          <USeparator />
          <div class="flex flex-wrap items-center justify-between gap-4">
            <span role="status" class="text-xs text-muted">{{
              dirty
                ? 'Ndryshime të paruajtura në profil'
                : saved
                  ? 'Identiteti u ruajt'
                  : 'Ruhet në llogarinë e biznesit.'
            }}</span
            ><UButton :loading="syncing" variant="outline" type="submit" icon="i-lucide-check"
              >Ruaj identitetin</UButton
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
            Këto janë të dhënat që plotëson ti. Informacioni nga profilet sociale do të shfaqet për
            kontroll pasi të lidhen llogaritë.
          </p>
          <UButton
            :to="`${base}/social-posts`"
            color="neutral"
            variant="outline"
            block
            trailing-icon="i-lucide-arrow-right"
            >Postimet nga rrjetet</UButton
          ></UCard
        ><UCard :ui="{ body: 'p-5 space-y-4' }"
          ><UIcon name="i-lucide-camera" class="size-5 text-primary" />
          <h2 class="text-sm font-semibold">Edhe fotografitë e tregojnë biznesin.</h2>
          <p class="text-sm text-muted leading-relaxed">
            Shto produktet, ambientin dhe momentet e tua.
          </p>
          <UButton
            :to="`${base}/gallery`"
            variant="link"
            class="p-0"
            trailing-icon="i-lucide-arrow-right"
            >Hap galerinë</UButton
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
