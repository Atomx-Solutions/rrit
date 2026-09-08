<script setup lang="ts">
import { z } from 'zod'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Biznesi im · Rrit' })
const { data, base, syncing, commit, notify } = useWorkspace()
const { form, clear, recovered, localError } = useDraft(
  `${base.value}:brand`,
  structuredClone(toRaw(data.value.brand)),
)
const baseline = ref(JSON.stringify(form))
const saved = ref(false)
const dirty = computed(() => JSON.stringify(form) !== baseline.value)
const schema = z.object({
  name: z.string().min(2, 'Vendos emrin e biznesit.'),
  city: z.string().min(2, 'Vendos qytetin.'),
  description: z.string().min(10, 'Trego shkurt çfarë ofron biznesi.'),
  voice: z.string(),
  audience: z.string(),
})
async function save() {
  const snapshot = structuredClone(toRaw(form))
  if (
    await commit((d) => {
      d.brand = snapshot
    })
  ) {
    clear()
    baseline.value = JSON.stringify(snapshot)
    saved.value = true
    notify('Identiteti i biznesit u ruajt')
  }
}
function addFact() {
  form.facts.push({
    id: crypto.randomUUID(),
    text: '',
    source: 'Plotësuar nga biznesi',
    verified: false,
  })
}
</script>
<template>
  <DashboardPage
    title="Biznesi im"
    description="Sa më mirë ta njohim biznesin, aq më natyrshëm mund të flasin postimet për të."
  >
    <UAlert v-if="localError" color="warning" variant="outline" :title="localError" />
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
              placeholder="P.sh. Njerëzit e lagjes dhe ata që punojnë afër nesh." /></UFormField
          ><UAccordion
            :items="[{ label: 'Detaje që postimet duhet t’i kenë të sakta', slot: 'facts' }]"
            ><template #facts
              ><div class="space-y-4 pb-4">
                <p class="text-sm text-muted leading-relaxed">
                  Orari, adresa, çmimet ose shërbimet. Shëno edhe nga vjen informacioni.
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
                      maxlength="1000" /></UFormField
                  ><UFormField label="Burimi"
                    ><UInput v-model="fact.source" class="w-full" maxlength="500"
                  /></UFormField>
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
          ><USeparator />
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
  </DashboardPage>
</template>
