<script setup lang="ts">
const props = defineProps<{ month: string }>()
const { data: workspace, base, initLive, syncing } = useWorkspace()
const {
  data: planner,
  error: loadError,
  refresh,
} = await useFetch('/api/ai/monthly-plan', {
  query: computed(() => ({ month: props.month })),
  key: 'monthly-planner',
})

const busy = ref(false)
const error = ref('')
const researchOpen = ref(false)
const resetOpen = ref(false)
const photoMode = ref<'auto' | 'selected'>(planner.value?.photoPreference?.mode || 'auto')
const selectedPhotoIds = ref<string[]>([
  ...(planner.value?.photoPreference?.selectedAssetIds || []),
])
const originalPhotos = computed(() =>
  workspace.value.assets.filter((asset) => asset.rights && !asset.generated).slice(0, 40),
)

function togglePhoto(id: string) {
  selectedPhotoIds.value = selectedPhotoIds.value.includes(id)
    ? selectedPhotoIds.value.filter((item) => item !== id)
    : [...selectedPhotoIds.value, id]
}

const phases = [
  { key: 'research', label: 'Hulumtimi', description: 'Tregu, audienca dhe platformat' },
  { key: 'planning', label: 'Strategjia', description: 'Temat, kanalet dhe oraret' },
  { key: 'content', label: 'Krijimi', description: 'Teksti, dizajni dhe kontrolli' },
] as const

const plan = computed(() => planner.value?.plan)
const active = computed(() => ['queued', 'running'].includes(plan.value?.status || ''))
const blocked = computed(() => plan.value?.status === 'blocked')
const ready = computed(() => plan.value?.status === 'review')
const automaticRecoveryCodes = [
  'PROVIDER_TEMPORARY',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNCERTAIN',
  'INVALID_SLOT_DATE',
  'INVALID_SLOT_COUNT',
  'UNGROUNDED_PLAN',
  'REPETITIVE_PLAN',
  'PHOTO_SELECTION_MISSING',
  'UNGROUNDED_CONTENT',
  'QUALITY_BLOCKED',
  'GENERATION_FAILED',
]
const recovering = computed(
  () =>
    active.value &&
    (!planner.value?.workerAlive || automaticRecoveryCodes.includes(plan.value?.errorCode || '')),
)
const phaseIndex = computed(() => {
  if (ready.value) return phases.length
  return Math.max(
    0,
    phases.findIndex((phase) => phase.key === plan.value?.stage),
  )
})

const activeCopy = computed(() => {
  if (recovering.value)
    return {
      title: 'Po përgatitim versionin e radhës',
      description:
        'Asgjë nuk humbi. Sistemi vazhdon nga faza e ruajtur dhe nuk përsërit asnjë thirrje AI të përfunduar.',
    }
  if (plan.value?.stage === 'research')
    return {
      title: 'Po hulumtojmë tregun',
      description:
        'Një thirrje AI po mbledh burime reale për tregun, audiencën dhe mënyrën si funksionojnë Instagrami e Facebooku.',
    }
  if (plan.value?.stage === 'planning')
    return {
      title: 'Po ndërtojmë strategjinë e muajit',
      description:
        'Një thirrje AI krijon tërë kalendarin: temat, kanalet dhe oraret për numrin e postimeve të paketës.',
    }
  return {
    title: 'Po krijojmë postimet',
    description:
      'Çdo postim po kalon në tekst, dizajn me fotografinë tënde dhe kontroll të cilësisë para se të ruhet.',
  }
})

const failureCopy = computed(() => {
  const failures: Record<string, { title: string; description: string }> = {
    PROVIDER_CREDIT_REQUIRED: {
      title: 'Krediti i shërbimit AI nuk mjaftoi',
      description:
        'Përgatitja u ndal pa humbur asgjë. Pasi të shtosh kredit, vazhdo procesin nga ky buton.',
    },
    PROVIDER_RATE_LIMITED: {
      title: 'Shërbimi AI është përkohësisht i zënë',
      description: 'Asgjë nuk është humbur ose publikuar. Prit pak dhe vazhdo përgatitjen.',
    },
    PROVIDER_UNCERTAIN: {
      title: 'Kërkohet kontroll teknik',
      description:
        'Riprovimi automatik nuk ishte i sigurt. Fotografitë, hulumtimi, strategjia dhe çdo draft i ruajtur mbeten të paprekura.',
    },
    PROVIDER_RETRY_EXHAUSTED: {
      title: 'Thirrja AI nuk përfundoi',
      description:
        'Procesi u ndal pa riprovim automatik që të mos krijojë kosto të dytë. Rezultatet e ruajtura janë të sigurta.',
    },
    BUDGET_ESTIMATE_EXCEEDED: {
      title: 'Procesi u ndal te kufiri i sigurisë',
      description:
        'Platforma duhet ta kontrollojë koston e kësaj kërkese përpara se përgatitja të vazhdojë.',
    },
    QUALITY_BLOCKED: {
      title: 'Dizajni kërkon rishikim',
      description:
        'Vazhdo një herë për ta ruajtur si draft. Pastaj ti vendos në Content Studio nëse dëshiron ta përmirësosh.',
    },
    INVALID_SLOT_DATE: {
      title: 'Një orar i propozuar kishte kaluar',
      description:
        'Plani u ndal që të mos ruante një postim në të kaluarën. Vazhdo përgatitjen për një kalendar të korrigjuar.',
    },
  }
  return (
    failures[plan.value?.errorCode || ''] || {
      title: 'Përgatitja u ndal',
      description:
        plan.value?.error ||
        'Asgjë nuk është publikuar. Mund ta provosh përsëri pa humbur fotografitë.',
    }
  )
})

const updatedAt = computed(() => {
  if (!plan.value?.updatedAt) return ''
  return new Intl.DateTimeFormat('sq-AL', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(new Date(plan.value.updatedAt))
})

async function act(action: 'prepare' | 'restart' | 'reset' | 'pause' | 'enable') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  if (action === 'prepare' && photoMode.value === 'selected' && !selectedPhotoIds.value.length) {
    error.value = 'Zgjidh të paktën një fotografi ose lëre AI të vendosë.'
    busy.value = false
    return
  }
  try {
    await $fetch('/api/ai/monthly-plan', {
      method: 'POST',
      body: {
        action,
        month: props.month,
        ...(action === 'prepare'
          ? {
              photoMode: photoMode.value,
              selectedAssetIds: photoMode.value === 'selected' ? selectedPhotoIds.value : [],
            }
          : {}),
      },
      retry: 0,
    })
    await refresh()
    if (action === 'reset') {
      resetOpen.value = false
      photoMode.value = 'auto'
      selectedPhotoIds.value = []
      await initLive()
    }
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message ||
      'Ndryshimi nuk u ruajt. Provo sërish.'
  } finally {
    busy.value = false
  }
}

let timer: ReturnType<typeof setInterval> | undefined
let polling = false
onMounted(() => {
  timer = setInterval(async () => {
    if (polling || document.hidden) return
    polling = true
    const before = planner.value?.plan?.completed
    try {
      await refresh()
      if (!syncing.value && planner.value?.plan?.completed !== before) await initLive()
    } catch {
      /* The last persisted state remains visible. */
    } finally {
      polling = false
    }
  }, 15000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }" class="overflow-hidden">
    <div class="p-4">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-3.5">
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <UIcon name="i-lucide-sparkles" class="size-4" />
          </div>
          <div class="min-w-0">
            <UBadge color="neutral" variant="subtle" size="sm">AI Monthly Studio</UBadge>
            <h2 class="mt-2 text-base font-semibold text-highlighted">
              Kalendari yt, i menduar përpara
            </h2>
            <p v-if="planner" class="mt-1 max-w-2xl text-xs leading-5 text-muted">
              AI hulumton, planifikon dhe përgatit deri në {{ planner.limit }} postime. Asgjë nuk
              publikohet pa miratimin tënd.
            </p>
            <p v-else class="mt-1 text-sm text-muted">Po kontrollojmë paketën dhe shërbimin AI.</p>
          </div>
        </div>
        <div v-if="plan && plan.status !== 'cancelled'" class="flex flex-wrap gap-1">
          <UButton
            v-if="active"
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-pause"
            :loading="busy"
            @click="act('pause')"
          >
            Pauzo
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-rotate-ccw"
            :disabled="busy"
            @click="resetOpen = true"
          >
            Fillo nga e para
          </UButton>
        </div>
      </div>
    </div>

    <div v-if="loadError" class="border-t border-default p-4">
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-wifi-off"
        title="Nuk mund të lidhemi me serverin"
        description="Rifresko faqen pasi aplikacioni të jetë nisur. Paketa dhe të dhënat e tua nuk kanë ndryshuar."
      />
    </div>

    <div v-else-if="!planner" class="border-t border-default p-4">
      <div class="flex items-center gap-3 text-sm text-muted" role="status">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        Po kontrollojmë përgatitjen mujore…
      </div>
    </div>

    <div v-else-if="!planner.configured" class="border-t border-default p-4">
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-settings"
        title="Shërbimi AI nuk është konfiguruar"
        description="Platforma duhet ta aktivizojë shërbimin përpara se të përgatitet ky muaj."
      />
    </div>

    <div v-else-if="!planner.entitled" class="border-t border-default p-4">
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-package"
        title="Nuk ka paketë aktive"
        description="Të gjitha paketat përfshijnë AI Monthly Studio. Aktivizo Fillimi për 12, Përditë për 30 ose Më shumë për 60 postime në muaj."
      />
    </div>

    <div v-else-if="!planner.enabled" class="border-t border-default p-4">
      <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-elevated/50 p-4">
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-pause-circle" class="mt-0.5 size-5 text-muted" />
          <div>
            <h3 class="text-sm font-semibold text-highlighted">Përgatitja është në pauzë</h3>
            <p class="mt-1 text-sm text-muted">
              Draftet dhe fotografitë e ruajtura nuk ndryshojnë.
            </p>
          </div>
        </div>
        <UButton size="sm" icon="i-lucide-play" :loading="busy" @click="act('enable')">
          Aktivizo
        </UButton>
      </div>
    </div>

    <div v-else-if="planner.prerequisite" class="border-t border-default p-4">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-5 text-warning" />
          <div>
            <h3 class="text-sm font-semibold text-highlighted">Duhet edhe një hap</h3>
            <p class="mt-1 text-sm text-muted">{{ planner.prerequisite }}</p>
            <div v-if="planner.prerequisites?.length" class="mt-3 space-y-2">
              <p class="text-xs font-semibold uppercase tracking-wide text-warning">
                Plotëso këto para gjenerimit
              </p>
              <div
                v-for="item in planner.prerequisites"
                :key="item.id"
                class="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2"
              >
                <p class="text-sm font-medium text-highlighted">{{ item.label }}</p>
                <p class="mt-0.5 text-xs leading-5 text-muted">{{ item.description }}</p>
              </div>
            </div>
          </div>
        </div>
        <UButton :to="`${base}/brand`" variant="outline" color="neutral" size="sm">
          Plotëso biznesin
        </UButton>
      </div>
    </div>

    <div v-else-if="blocked && plan" class="border-t border-default p-4">
      <div class="rounded-xl border border-warning/20 bg-warning/5 p-4" aria-live="polite">
        <div class="flex items-start gap-3">
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"
          >
            <UIcon name="i-lucide-triangle-alert" class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge color="warning" variant="subtle">Kërkohet një hap</UBadge>
              <span v-if="updatedAt" class="text-xs text-muted">Përditësuar {{ updatedAt }}</span>
            </div>
            <h3 class="mt-2 text-base font-semibold text-highlighted">{{ failureCopy.title }}</h3>
            <p class="mt-1 max-w-2xl text-sm leading-6 text-muted">{{ failureCopy.description }}</p>
          </div>
        </div>

        <div class="mt-5 grid gap-3 sm:grid-cols-3">
          <div class="rounded-lg bg-default/70 px-3.5 py-3">
            <span class="block text-xs text-muted">Drafte të përfunduara</span>
            <strong class="mt-1 block text-sm font-semibold"
              >{{ plan.completed }} nga {{ plan.total }}</strong
            >
          </div>
          <div class="rounded-lg bg-default/70 px-3.5 py-3">
            <span class="block text-xs text-muted">Fotografitë origjinale</span>
            <strong class="mt-1 flex items-center gap-1.5 text-sm font-semibold">
              <UIcon name="i-lucide-shield-check" class="size-4 text-success" /> Të sigurta
            </strong>
          </div>
          <div class="rounded-lg bg-default/70 px-3.5 py-3">
            <span class="block text-xs text-muted">Publikime automatike</span>
            <strong class="mt-1 block text-sm font-semibold">Asnjë</strong>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap gap-2">
          <UButton
            v-if="plan.restartable"
            icon="i-lucide-refresh-cw"
            :loading="busy"
            @click="act('restart')"
          >
            Vazhdo përgatitjen
          </UButton>
          <UButton
            v-if="plan.research"
            variant="outline"
            color="neutral"
            icon="i-lucide-book-open"
            @click="researchOpen = true"
          >
            Shiko strategjinë dhe hulumtimin
          </UButton>
        </div>
      </div>
    </div>

    <div v-else-if="active && plan" class="border-t border-default p-4" aria-live="polite">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-start gap-3">
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <UBadge :color="recovering ? 'warning' : 'primary'" variant="subtle">
                {{ recovering ? 'Po rikuperohet' : 'Duke punuar' }}
              </UBadge>
              <span class="text-xs text-muted">Mund të largohesh nga kjo faqe</span>
            </div>
            <h3 class="mt-2 text-base font-semibold text-highlighted">{{ activeCopy.title }}</h3>
            <p class="mt-1 max-w-2xl text-sm leading-6 text-muted">{{ activeCopy.description }}</p>
          </div>
        </div>
        <span class="text-sm font-medium">{{ plan.completed }} / {{ plan.total }} drafte</span>
      </div>

      <UProgress class="mt-5" :model-value="plan.completed" :max="plan.total" size="sm" />
      <div
        v-if="plan.stage === 'content'"
        class="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <strong class="text-sm text-highlighted">
            Postimi {{ Math.min(plan.completed + 1, plan.total) }} nga {{ plan.total }}
          </strong>
          <span class="text-xs text-muted">Pa rigjenerim automatik</span>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <UBadge color="neutral" variant="subtle">1 thirrje · Copy</UBadge>
          <UBadge color="neutral" variant="subtle">1 thirrje · Imazhi AI 4:5</UBadge>
          <UBadge color="neutral" variant="subtle">1 thirrje · Kontrolli</UBadge>
          <UBadge color="success" variant="subtle">Drafti i parë ruhet</UBadge>
        </div>
      </div>
      <p
        v-if="plan.completed === 0 && plan.stage !== 'content'"
        class="mt-2 text-xs leading-5 text-muted"
      >
        Drafti i parë shfaqet pasi të përfundojnë hulumtimi dhe strategjia. Prandaj 0 /
        {{ plan.total }}
        është normale në këtë fazë.
      </p>

      <div class="mt-5 grid gap-3 sm:grid-cols-3">
        <div
          v-for="(phase, index) in phases"
          :key="phase.key"
          class="flex items-start gap-3 rounded-lg border p-3"
          :class="index === phaseIndex ? 'border-primary/30 bg-primary/5' : 'border-default'"
        >
          <div
            class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
            :class="
              index < phaseIndex
                ? 'bg-success/10 text-success'
                : index === phaseIndex
                  ? 'bg-primary/10 text-primary'
                  : 'bg-elevated text-muted'
            "
          >
            <UIcon
              :name="
                index < phaseIndex
                  ? 'i-lucide-check'
                  : index === phaseIndex
                    ? 'i-lucide-loader-circle'
                    : 'i-lucide-circle'
              "
              class="size-3.5"
              :class="index === phaseIndex ? 'animate-spin' : ''"
            />
          </div>
          <div>
            <strong class="block text-sm font-medium">{{ phase.label }}</strong>
            <span class="mt-0.5 block text-xs leading-5 text-muted">{{ phase.description }}</span>
          </div>
        </div>
      </div>

      <div
        v-if="plan.stage === 'research' && !plan.research"
        class="mt-4 rounded-xl border border-default bg-elevated/40 p-4"
      >
        <div class="flex items-start gap-3">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <UIcon name="i-lucide-search" class="size-4 text-primary" />
          </div>
          <div class="min-w-0">
            <h4 class="text-sm font-semibold text-highlighted">Çfarë po kërkon sistemi</h4>
            <p class="mt-1 text-xs leading-5 text-muted">
              Burimet dhe përfundimet shfaqen sapo përgjigjja të ruhet—pa paraqitur rezultate të
              sajuara gjatë pritjes.
            </p>
          </div>
        </div>
        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <div
            v-for="item in [
              'Tregu lokal, audienca dhe sezonaliteti',
              'Pozicionimi dhe mundësitë e përmbajtjes',
              'Udhëzimet aktuale për Instagram e Facebook',
              'Hipotezat e orarit dhe boshllëqet në të dhëna',
            ]"
            :key="item"
            class="flex items-center gap-2 rounded-lg bg-default px-3 py-2.5 text-xs text-toned"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="size-3.5 shrink-0 animate-spin text-primary"
            />
            {{ item }}
          </div>
        </div>
      </div>

      <div
        v-if="plan.research"
        class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/20 bg-success/5 p-4"
      >
        <div class="flex items-start gap-3">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <UIcon name="i-lucide-book-check" class="size-4 text-success" />
          </div>
          <div>
            <h4 class="text-sm font-semibold text-highlighted">Hulumtimi është ruajtur</h4>
            <p class="mt-0.5 text-xs leading-5 text-muted">
              {{ plan.research.sources.length }} burime reale po përdoren nga strategjia dhe
              postimet. Kjo fazë nuk përsëritet.
            </p>
          </div>
        </div>
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          icon="i-lucide-expand"
          @click="researchOpen = true"
        >
          Hap strategjinë dhe hulumtimin
        </UButton>
      </div>

      <UAlert
        v-if="!planner.workerAlive"
        class="mt-4"
        color="warning"
        variant="subtle"
        icon="i-lucide-clock"
        title="Procesi po pret worker-in"
        description="Përgatitja do të vazhdojë automatikisht sapo shërbimi në sfond të lidhet."
      />
    </div>

    <div v-else-if="ready && plan" class="border-t border-default p-4">
      <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-success/5 p-4">
        <div class="flex items-start gap-3">
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
          >
            <UIcon name="i-lucide-circle-check" class="size-5" />
          </div>
          <div>
            <UBadge color="success" variant="subtle">Muaji është gati</UBadge>
            <h3 class="mt-2 text-base font-semibold text-highlighted">
              {{ plan.completed }} postime presin miratimin tënd
            </h3>
            <p class="mt-1 text-sm text-muted">
              Hapi tjetër është t’i kontrollosh në Content Studio.
            </p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="plan.research"
            variant="outline"
            color="neutral"
            icon="i-lucide-book-open"
            @click="researchOpen = true"
          >
            Shiko strategjinë dhe hulumtimin
          </UButton>
          <UButton :to="`${base}/content`" trailing-icon="i-lucide-arrow-right">
            Rishiko postimet
          </UButton>
        </div>
      </div>
    </div>

    <div v-else class="border-t border-default p-4">
      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-primary">Fotografitë e muajit</p>
        <h3 class="mt-1 text-base font-semibold text-highlighted">
          A dëshiron ta zgjedhësh ti ndonjë fotografi?
        </h3>
        <p class="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Origjinalet mbeten në galeri. AI krijon kopje të pastruara, profesionale dhe të dizajnuara
          në format 4:5.
        </p>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            class="rounded-xl border p-4 text-left transition"
            :class="
              photoMode === 'auto'
                ? 'border-primary/40 bg-primary/5'
                : 'border-default hover:bg-elevated/50'
            "
            @click="photoMode = 'auto'"
          >
            <span class="flex items-center gap-2 text-sm font-semibold text-highlighted">
              <UIcon name="i-lucide-sparkles" class="size-4 text-primary" /> Le të vendosë AI
            </span>
            <span class="mt-1.5 block text-xs leading-5 text-muted">
              AI inspekton galerinë dhe zgjedh fotografinë më të fortë për secilin intent.
            </span>
          </UButton>
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            class="rounded-xl border p-4 text-left transition"
            :class="
              photoMode === 'selected'
                ? 'border-primary/40 bg-primary/5'
                : 'border-default hover:bg-elevated/50'
            "
            @click="photoMode = 'selected'"
          >
            <span class="flex items-center gap-2 text-sm font-semibold text-highlighted">
              <UIcon name="i-lucide-image-check" class="size-4 text-primary" /> Dua të zgjedh foto
            </span>
            <span class="mt-1.5 block text-xs leading-5 text-muted">
              Gjenerimi përdor vetëm fotografitë që zgjedh këtu. Ato mund të ripërdoren kur ka më
              shumë postime se fotografi.
            </span>
          </UButton>
        </div>
        <div v-if="photoMode === 'selected'" class="mt-4">
          <div
            v-if="originalPhotos.length"
            class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6"
          >
            <UButton
              v-for="asset in originalPhotos"
              :key="asset.id"
              type="button"
              color="neutral"
              variant="outline"
              class="group relative overflow-hidden rounded-xl border bg-elevated text-left transition"
              :class="
                selectedPhotoIds.includes(asset.id)
                  ? 'border-primary ring-2 ring-primary/20'
                  : 'border-default hover:border-primary/30'
              "
              :aria-pressed="selectedPhotoIds.includes(asset.id)"
              @click="togglePhoto(asset.id)"
            >
              <MediaImage
                :src="asset.url"
                :alt="asset.name"
                class="aspect-[4/5] w-full object-cover"
              />
              <span class="block truncate px-2.5 py-2 text-xs font-medium">{{ asset.name }}</span>
              <span
                v-if="selectedPhotoIds.includes(asset.id)"
                class="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-white shadow"
              >
                <UIcon name="i-lucide-check" class="size-3.5" />
              </span>
            </UButton>
          </div>
          <UAlert
            v-else
            class="mt-3"
            color="warning"
            variant="subtle"
            title="Nuk ka fotografi origjinale me të drejta aktive"
            description="Ngarko fotografi në Galeri ose zgjidh opsionin që AI të vendosë pasi t'i ngarkosh."
          />
          <p v-if="selectedPhotoIds.length" class="mt-2 text-xs text-muted">
            Vetëm {{ selectedPhotoIds.length }}
            {{ selectedPhotoIds.length === 1 ? 'fotografi do të përdoret' : 'fotografi do të përdoren' }}
            në gjenerim.
          </p>
        </div>
      </div>

      <div
        class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4"
      >
        <div>
          <h3 class="text-sm font-semibold text-highlighted">Gati për ta përgatitur këtë muaj</h3>
          <p class="mt-1 max-w-xl text-sm leading-6 text-muted">
            Fillojmë me hulumtim real, ndërtojmë strategjinë dhe pastaj krijojmë draftet një nga
            një.
          </p>
        </div>
        <UButton :loading="busy" icon="i-lucide-calendar-plus" @click="act('prepare')">
          Përgatit këtë muaj
        </UButton>
      </div>
    </div>

    <div v-if="error" class="border-t border-default p-4">
      <UAlert color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
    </div>

    <UModal
      v-model:open="resetOpen"
      title="Fillo planin nga e para"
      description="Hiqen vetëm draftet dhe dizajnet e krijuara nga ky plan. Fotografitë origjinale në galeri nuk preken."
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="Ky veprim nuk prek fotografitë origjinale"
          description="Hulumtimi, strategjia dhe draftet aktuale të këtij muaji pastrohen që të krijohet një plan i ri me workflow-in e përmirësuar."
        />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="busy" @click="resetOpen = false"
            >Anulo</UButton
          >
          <UButton color="error" icon="i-lucide-rotate-ccw" :loading="busy" @click="act('reset')"
            >Pastro dhe fillo rishtas</UButton
          >
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="researchOpen"
      fullscreen
      title="Plani dhe hulumtimi"
      description="Strategjia, përfundimet dhe burimet reale të konsultuara për këtë muaj."
    >
      <template #body>
        <div class="mx-auto w-full max-w-6xl space-y-8 py-2 sm:py-6">
          <div class="grid gap-4 sm:grid-cols-3">
            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <span class="text-xs font-medium text-muted">Statusi</span>
              <strong class="mt-2 flex items-center gap-2 text-sm font-semibold text-highlighted">
                <UIcon name="i-lucide-circle-check" class="size-4 text-success" />
                Hulumtim i përfunduar
              </strong>
            </div>
            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <span class="text-xs font-medium text-muted">Burime të konsultuara</span>
              <strong class="mt-1.5 block text-lg font-semibold text-highlighted">
                {{ plan?.research?.sources.length || 0 }}
              </strong>
            </div>
            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <span class="text-xs font-medium text-muted">Përdorimi</span>
              <strong class="mt-2 block text-sm font-semibold text-highlighted">
                Strategji, tekste dhe orare
              </strong>
            </div>
          </div>

          <MonthlyStrategyView
            v-if="plan?.strategy"
            :strategy="plan.strategy"
            :assets="originalPhotos"
          />
          <ResearchEvidence v-if="plan?.research" :research="plan.research" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
