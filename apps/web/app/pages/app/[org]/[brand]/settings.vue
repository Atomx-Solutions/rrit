<script setup lang="ts">
import { z } from 'zod'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
useSeoMeta({ title: 'Cilësimet · Rrit' })
const { data, base, syncing, commit, notify, exportData } = useWorkspace()
const { data: capabilities } = await useFetch('/api/capabilities')
const route = useRoute()
const tabNames = ['profile', 'preferences', 'notifications', 'security', 'organization']
const tab = computed({
  get: () =>
    typeof route.query.tab === 'string' && tabNames.includes(route.query.tab)
      ? route.query.tab
      : 'profile',
  set: (value: string) => {
    void navigateTo(
      { path: route.path, query: { ...route.query, tab: value === 'profile' ? undefined : value } },
      { replace: true },
    )
  },
})
const { form, clear, recovered, localError } = useDraft(`${base.value}:preferences`, {
  ...data.value.preferences,
})
const baseline = ref(JSON.stringify(form))
const dirty = computed(() => JSON.stringify(form) !== baseline.value)
const saved = ref(false)
const formError = ref('')
const leaveOpen = ref(false)
let resolveLeave: ((allow: boolean) => void) | undefined
const schema = z.object({
  name: z.string().trim().min(2, 'Vendos emrin tënd.').max(100),
  email: z.email('Vendos një adresë emaili të vlefshme.'),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('sq', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, 'Zgjidh një zonë kohore të vlefshme.'),
  locale: z.enum(['sq-XK', 'en-US']),
  currency: z.literal('EUR'),
})
async function save() {
  formError.value = ''
  const snapshot = { ...form }
  if (await commit((d) => (d.preferences = snapshot))) {
    notify()
    baseline.value = JSON.stringify(snapshot)
    saved.value = true
    formError.value = ''
    clear()
  } else {
    formError.value = 'Ndryshimet nuk u ruajtën. Kontrollo gabimin ose ngarko versionin e fundit.'
  }
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
</script>
<template>
  <DashboardPage title="Cilësimet" description="Profili, preferencat dhe siguria në një vend.">
    <template #toolbar>
      <UTabs
        v-model="tab"
        :items="[
          { id: 'profile', label: 'Profili' },
          { id: 'preferences', label: 'Preferencat' },
          { id: 'notifications', label: 'Njoftimet' },
          { id: 'security', label: 'Siguria' },
          { id: 'organization', label: 'Organizata' },
        ]"
        value-key="id"
        :content="false"
        variant="link"
        class="w-full"
        :ui="{ list: 'flex-wrap gap-1', trigger: 'grow-0 px-3 min-h-10' }"
      />
    </template>
    <UAlert
      v-if="localError"
      color="warning"
      variant="outline"
      :title="localError"
      class="max-w-3xl"
    />
    <UAlert
      v-else-if="recovered"
      color="neutral"
      variant="outline"
      icon="i-lucide-history"
      title="Ndryshimet e fundit janë rikthyer"
      description="Kontrolloji dhe ruaji për ta përditësuar profilin."
      class="max-w-3xl"
    />
    <UCard class="max-w-3xl" :ui="{ body: 'p-5 sm:p-7' }"
      ><AccountSecurity v-if="tab === 'security'" /><UForm
        v-else
        :state="form"
        :schema="schema"
        class="space-y-6"
        @submit="save"
        @error="
          formError = 'Kontrollo emrin dhe emailin te Profili, si dhe zonën kohore te Preferencat.'
        "
      >
        <UAlert v-if="formError" color="error" variant="outline" :title="formError" />
        <template v-if="tab === 'profile'"
          ><div class="actions">
            <UAvatar :alt="form.name" size="xl" />
            <div class="space-y-1">
              <h2>Profili yt</h2>
              <p class="small muted mt-1">Llogaria e biznesit</p>
            </div>
          </div>
          <UFormField label="Emri i plotë" name="name" class="field"
            ><UInput
              v-model="form.name"
              class="w-full"
              required
              minlength="2"
              maxlength="100" /></UFormField
          ><UFormField label="Email" name="email" class="field"
            ><UInput v-model="form.email" class="w-full" type="email" required /><small
              >Kjo është adresa e kontaktit. Emaili i hyrjes në llogari mbetet i pandryshuar.</small
            ></UFormField
          ></template
        ><template v-if="tab === 'preferences'"
          ><h2>Gjuha dhe rajoni</h2>
           <UFormField label="Gjuha" name="locale" class="field"
            ><USelect
              v-model="form.locale"
              :items="[
                { label: 'Shqip · Kosovë', value: 'sq-XK' },
                { label: 'English · United States', value: 'en-US' },
              ]"
            /></UFormField
          ><UFormField label="Zona kohore" name="timezone" class="field"
            ><USelect
              v-model="form.timezone"
              :items="[
                { label: 'Kosovë · ora lokale', value: 'Europe/Belgrade' },
                { label: 'Shqipëri · ora lokale', value: 'Europe/Tirane' },
                { label: 'Maqedoni e Veriut · ora lokale', value: 'Europe/Skopje' },
                { label: 'Mbretëria e Bashkuar', value: 'Europe/London' },
              ]" /></UFormField
          ><UFormField label="Monedha" name="currency" class="field"
            ><USelect
              v-model="form.currency"
              :items="[{ label: 'Euro (EUR)', value: 'EUR' }]"
            /><small>Çmimet e paketave paraqiten në euro.</small></UFormField
          ></template
        ><template v-if="tab === 'notifications'"
          ><h2>Vetëm njoftimet që të duhen</h2>
          <div
            v-for="item in [
              {
                key: 'emailApprovals' as const,
                label: 'Përmbajtje për miratim',
                text: 'Kur një postim është gati për rishikimin tënd.',
              },
              {
                key: 'emailPublished' as const,
                label: 'Publikime të përfunduara',
                text: 'Përmbledhje e postimeve të konfirmuara.',
              },
              {
                key: 'emailTips' as const,
                label: 'Ide & këshilla produkti',
                text: 'Udhëzime për ta përdorur më mirë Rrit.',
              },
            ]"
            :key="item.key"
            class="flex items-start justify-between gap-5 border-b border-default pb-5"
          >
            <div>
              <h3>{{ item.label }}</h3>
              <p class="small muted mt-2">{{ item.text }}</p>
            </div>
            <USwitch v-model="form[item.key]" :aria-label="item.label" class="shrink-0 mt-1" />
          </div>
          <UAlert
            color="neutral"
            variant="outline"
            title="Preferencat e njoftimeve"
            :description="`Preferencat ruhen në llogari. ${capabilities?.emailVerificationRequired ? 'Email-i i verifikimit është aktiv. ' : ''}${capabilities?.passwordRecovery ? 'Rikuperimi me email është aktiv. ' : 'Rikuperimi me email aktivizohet pasi të konfigurohet shërbimi i emailit. '}Njoftimet e postimeve me email janë ende në përgatitje.`" /></template
        ><template v-if="tab === 'organization'"
          ><h2>Menaxhimi i hapësirës</h2>
          <div class="actions">
            <UButton :to="`${base}/brand`" variant="outline" color="neutral"
              >Identiteti i biznesit</UButton
            ><UButton :to="`${base}/billing`" variant="outline" color="neutral"
              >Plani & faturimi</UButton
            >
          </div>
          <USeparator class="divider" />
          <h3>Një kopje e punës tënde</h3>
          <p class="text-sm text-muted">
            Shkarko një skedar me postimet, profilin dhe të dhënat e biznesit.
          </p>
          <UButton icon="i-lucide-download" variant="outline" @click="exportData"
            >Eksporto të dhënat</UButton
          >
        </template>
        <div
          v-if="['profile', 'preferences', 'notifications'].includes(tab)"
          class="flex flex-wrap items-center gap-4 border-t border-default pt-5"
        >
          <UButton
            variant="outline"
            type="submit"
            :loading="syncing"
            icon="i-lucide-save"
            style="align-self: flex-start"
            >Ruaj ndryshimet</UButton
          ><span role="status" class="text-xs text-muted">{{
            dirty
              ? 'Ke ndryshime të paruajtura'
              : saved
                ? 'Ndryshimet u ruajtën'
                : 'Preferencat ruhen në llogarinë tënde.'
          }}</span>
        </div>
      </UForm></UCard
    >
    <UnsavedChangesModal
      :open="leaveOpen"
      :saving="syncing"
      @update:open="handleLeaveOpen"
      @save="saveAndLeave"
      @discard="discardAndLeave"
    />
  </DashboardPage>
</template>
