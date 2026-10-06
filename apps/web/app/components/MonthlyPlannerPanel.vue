<script setup lang="ts">
const props = defineProps<{ month: string }>()
const { t } = useI18n()
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
const { showError, watchError } = useFormFeedback()
watchError(error)
watch(loadError, (value) => {
  if (value) showError(t('monthly.serverUnavailableDescription'), 'warning')
}, { immediate: true })
const researchOpen = ref(false)
const resetOpen = ref(false)
const photoMode = ref<'auto' | 'selected'>(planner.value?.photoPreference?.mode || 'auto')
const originalPhotos = computed(() =>
  workspace.value.assets
    .filter((asset) => asset.kind === 'photo' && asset.rights && !asset.generated)
)
const {
  page: photoPage,
  pageSize: photoPageSize,
  total: photoTotal,
  paginated: paginatedOriginalPhotos,
} = usePagination(originalPhotos, 16)
const photoPageCount = computed(() => Math.max(1, Math.ceil(photoTotal.value / photoPageSize.value)))
const selectedPhotoIds = ref<string[]>([
  ...(planner.value?.photoPreference?.selectedAssetIds || []),
].filter((id) => originalPhotos.value.some((asset) => asset.id === id)))
watch(
  originalPhotos,
  (photos) => {
    const allowed = new Set(photos.map((photo) => photo.id))
    selectedPhotoIds.value = selectedPhotoIds.value.filter((id) => allowed.has(id))
  },
  { immediate: true },
)

function togglePhoto(id: string) {
  if (selectedPhotoIds.value.includes(id)) {
    selectedPhotoIds.value = selectedPhotoIds.value.filter(item => item !== id)
    return
  }
  // One photo is used per post, so choosing more than the month will produce is
  // a selection the planner has to reject later. Stopping it at the click says
  // so while the person can still act on it.
  if (selectedPhotoIds.value.length >= selectedQuantity.value) return
  selectedPhotoIds.value = [...selectedPhotoIds.value, id]
}

function openReport(type: 'research' | 'strategy') {
  if (!import.meta.client) return
  const url = `${base.value}/monthly-report?month=${encodeURIComponent(props.month)}&type=${type}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

const phases = [
  { key: 'research', label: t('monthly.phaseResearch'), description: t('monthly.phaseResearchDescription') },
  { key: 'planning', label: t('monthly.phaseStrategy'), description: t('monthly.phaseStrategyDescription') },
  { key: 'content', label: t('monthly.phaseContent'), description: t('monthly.phaseContentDescription') },
] as const

const plan = computed(() => planner.value?.plan)
const selectedQuantity = ref(1)
const selectedVideoQuantity = ref(0)
// Which platforms this request is for. Both selected is the absence of a
// restriction, which is how the planner behaved before the choice existed.
type PlannerChannel = 'Instagram' | 'Facebook'
const channelOptions: { value: PlannerChannel; label: string; icon: string }[] = [
  { value: 'Instagram', label: 'Instagram', icon: 'i-lucide-instagram' },
  { value: 'Facebook', label: 'Facebook', icon: 'i-lucide-facebook' },
]
const channelSplit = reactive<Record<PlannerChannel, number>>({ Instagram: 0, Facebook: 0 })
const requestOpen = ref(false)
const requestAction = ref<'prepare' | 'generate'>('prepare')
const splitAssigned = computed(() => channelSplit.Instagram + channelSplit.Facebook)
// A single post is a choice between platforms, not an allocation across them.
const singlePost = computed(() => selectedQuantity.value === 1)
const splitComplete = computed(() => splitAssigned.value === selectedQuantity.value)
function openRequest(action: 'prepare' | 'generate') {
  if (action === 'prepare' && photoMode.value === 'selected' && !selectedPhotoIds.value.length) {
    error.value = t('monthly.selectPhotoRequired')
    return
  }
  requestAction.value = action
  // Start from everything on Instagram for one post, and an even split
  // otherwise, so the common case needs no arithmetic from the customer.
  const half = Math.floor(selectedQuantity.value / 2)
  channelSplit.Instagram = selectedQuantity.value - half
  channelSplit.Facebook = half
  requestOpen.value = true
}
function chooseSingleChannel(channel: PlannerChannel) {
  channelSplit.Instagram = channel === 'Instagram' ? 1 : 0
  channelSplit.Facebook = channel === 'Facebook' ? 1 : 0
}
function setChannelCount(channel: PlannerChannel, value: number) {
  const other: PlannerChannel = channel === 'Instagram' ? 'Facebook' : 'Instagram'
  const next = Math.max(0, Math.min(value, selectedQuantity.value))
  channelSplit[channel] = next
  // Keep the pair consistent with the number of posts being requested, so the
  // customer adjusts one side rather than solving for both.
  channelSplit[other] = selectedQuantity.value - next
}
// Platforms with no posts are left out entirely: zero is the absence of a
// request for that platform, not a request for none.
function requestedChannelCounts() {
  return Object.fromEntries(
    channelOptions.flatMap((option) =>
      channelSplit[option.value] > 0 ? [[option.value, channelSplit[option.value]]] : [],
    ),
  )
}
async function confirmRequest() {
  if (!splitComplete.value) return
  requestOpen.value = false
  await act(requestAction.value)
}
const remainingPosts = computed(() => planner.value?.usage?.remaining || 0)
watch(remainingPosts, (remaining) => {
  selectedQuantity.value = Math.max(1, Math.min(selectedQuantity.value, remaining || 1))
}, { immediate: true })
// Lowering the post count leaves photos chosen that no longer have a post to go
// with, so the extras are released rather than left to fail at submission.
watch(selectedQuantity, (quantity) => {
  if (selectedPhotoIds.value.length > quantity)
    selectedPhotoIds.value = selectedPhotoIds.value.slice(0, quantity)
  selectedVideoQuantity.value = Math.min(selectedVideoQuantity.value, quantity)
})
const active = computed(() => ['queued', 'running'].includes(plan.value?.status || ''))
const blocked = computed(() => plan.value?.status === 'blocked')
const ready = computed(() => plan.value?.status === 'review')
const tiktokTargetPost = computed(() =>
  workspace.value.posts.find((post) => ['draft', 'review'].includes(post.status) && post.image),
)
// Everything the customer asked for is produced, and the package still owes
// posts. This is a resting state with two next steps: look at what arrived, or
// ask for more.
const settled = computed(() => plan.value?.status === 'idle' && (plan.value?.completed || 0) > 0)
// A plan that produced everything asked of it but still owes posts from the
// package. Posts are drawn on request, so this is a normal resting state, not
// an end state.
const extendable = computed(() => !!plan.value?.extendable && remainingPosts.value > 0)
// Progress is measured against what the customer asked for, not against the
// month's whole quota: asking for one post and being shown "0 / 11" reports a
// job eleven times larger than the one running.
const batchTotal = computed(() => plan.value?.batch?.total || plan.value?.requested || plan.value?.total || 0)
// Produced within the running request, so a second request for one post starts
// again at zero instead of continuing the month's running total.
const batchCompleted = computed(() =>
  Math.max(0, Math.min(plan.value?.batch?.completed ?? plan.value?.completed ?? 0, batchTotal.value)),
)
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
      title: t('monthly.recoveringTitle'),
      description: t('monthly.recoveringDescription'),
    }
  if (plan.value?.stage === 'research')
    return {
      title: t('monthly.researchingTitle'),
      description: t('monthly.researchingDescription'),
    }
  if (plan.value?.stage === 'planning')
    return {
      title: t('monthly.planningTitle'),
      description: t('monthly.planningDescription'),
    }
  return {
    title: t('monthly.creatingTitle'),
    description: t('monthly.creatingDescription'),
  }
})

const failureCopy = computed(() => {
  const failures: Record<string, { title: string; description: string }> = {
    PROVIDER_CREDIT_REQUIRED: {
      title: t('monthly.failureProviderCreditTitle'),
      description: t('monthly.failureProviderCreditDescription'),
    },
    PROVIDER_RATE_LIMITED: {
      title: t('monthly.failureRateLimitTitle'),
      description: t('monthly.failureRateLimitDescription'),
    },
    PROVIDER_UNCERTAIN: {
      title: t('monthly.failureUncertainTitle'),
      description: t('monthly.failureUncertainDescription'),
    },
    PROVIDER_RETRY_EXHAUSTED: {
      title: t('monthly.failureRetryTitle'),
      description: t('monthly.failureRetryDescription'),
    },
    BUDGET_ESTIMATE_EXCEEDED: {
      title: t('monthly.failureBudgetTitle'),
      description: t('monthly.failureBudgetDescription'),
    },
    QUALITY_BLOCKED: {
      title: t('monthly.failureQualityTitle'),
      description: t('monthly.failureQualityDescription'),
    },
    INVALID_SLOT_DATE: {
      title: t('monthly.failureDateTitle'),
      description: t('monthly.failureDateDescription'),
    },
  }
  return (
    failures[plan.value?.errorCode || ''] || {
      title: t('monthly.failureDefaultTitle'),
      description: plan.value?.error || t('monthly.failureDefaultDescription'),
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

async function act(action: 'prepare' | 'generate' | 'restart' | 'reset' | 'pause' | 'enable') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  if (action === 'prepare' && photoMode.value === 'selected' && !selectedPhotoIds.value.length) {
    error.value = t('monthly.selectPhotoRequired')
    busy.value = false
    return
  }
  try {
    await $fetch('/api/ai/monthly-plan', {
      method: 'POST',
      body: {
        action,
        month: props.month,
        ...(action === 'generate'
          ? { quantity: selectedQuantity.value, channelCounts: requestedChannelCounts(), includeTikTokVideos: selectedVideoQuantity.value > 0, videoQuantity: selectedVideoQuantity.value }
          : {}),
        ...(action === 'prepare'
          ? {
              photoMode: photoMode.value,
              selectedAssetIds: photoMode.value === 'selected' ? selectedPhotoIds.value : [],
              quantity: selectedQuantity.value,
              channelCounts: requestedChannelCounts(),
              includeTikTokVideos: selectedVideoQuantity.value > 0,
              videoQuantity: selectedVideoQuantity.value,
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
    const failure = problem as { data?: { message?: string; data?: { code?: string } } }
    // A trial that has used its 3 posts continues by choosing a package.
    if (failure.data?.data?.code === 'QUOTA_EXCEEDED' && !planner.value?.paid) {
      await navigateTo(`${unref(base)}/billing?reason=trial-limit`)
      return
    }
    error.value = failure.data?.message || t('monthly.changeNotSaved')
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
            <UBadge color="neutral" variant="subtle" size="sm">{{ t('monthly.title') }}</UBadge>
            <h2 class="mt-2 text-base font-semibold text-highlighted">
              {{ t('monthly.heading') }}
            </h2>
            <p v-if="planner" class="mt-1 max-w-2xl text-xs leading-5 text-muted">
              {{ t('monthly.description', { limit: planner.limit }) }}
            </p>
            <p v-else class="mt-1 text-sm text-muted">{{ t('monthly.checkingService') }}</p>
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
            {{ t('legacy.pause') }}
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-rotate-ccw"
            :disabled="busy"
            @click="resetOpen = true"
          >
            {{ t('legacy.startOver') }}
          </UButton>
        </div>
      </div>
    </div>

    <div v-if="!planner" class="border-t border-default p-4">
      <div class="flex items-center gap-3 text-sm text-muted" role="status">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        {{ t('legacy.monthlyChecking') }}
      </div>
    </div>

    <div v-else-if="!planner.configured" class="border-t border-default p-4">
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-settings"
        :title="t('monthly.aiNotConfiguredTitle')"
        :description="t('monthly.aiNotConfiguredDescription')"
      />
    </div>

    <div v-else-if="!planner.entitled" class="border-t border-default p-4">
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-package"
        :title="t('monthly.noActivePlanTitle')"
        :description="t('monthly.noActivePlanDescription')"
      />
    </div>

    <div v-else-if="!planner.enabled" class="border-t border-default p-4">
      <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-elevated/50 p-4">
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-pause-circle" class="mt-0.5 size-5 text-muted" />
          <div>
            <h3 class="text-sm font-semibold text-highlighted">{{ t('monthly.paused') }}</h3>
            <p class="mt-1 text-sm text-muted">
              {{ t('legacy.monthlySavedDescription') }}
            </p>
          </div>
        </div>
        <UButton size="sm" icon="i-lucide-play" :loading="busy" @click="act('enable')">
          {{ t('brain.activate') }}
        </UButton>
      </div>
    </div>

    <div v-else-if="planner.prerequisite" class="border-t border-default p-4">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-5 text-warning" />
          <div>
            <h3 class="text-sm font-semibold text-highlighted">{{ t('monthly.needStep') }}</h3>
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
        <UButton :to="`${base}/gallery?upload=1`" variant="outline" color="neutral" size="sm">
          {{ t('gallery.uploadPhotos') }}
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
              <UBadge color="warning" variant="subtle">{{ t('monthly.requiredStep') }}</UBadge>
              <span v-if="updatedAt" class="text-xs text-muted">{{ t('monthly.updatedAt', { time: updatedAt }) }}</span>
            </div>
            <h3 class="mt-2 text-base font-semibold text-highlighted">{{ failureCopy.title }}</h3>
            <p class="mt-1 max-w-2xl text-sm leading-6 text-muted">{{ failureCopy.description }}</p>
          </div>
        </div>

        <div class="mt-5 grid gap-3 sm:grid-cols-3">
          <div class="rounded-lg bg-default/70 px-3.5 py-3">
            <span class="block text-xs text-muted">{{ t('monthly.completedDrafts') }}</span>
            <strong class="mt-1 block text-sm font-semibold"
              >{{ batchCompleted }} {{ t('common.of') }} {{ batchTotal }}</strong
            >
          </div>
          <div class="rounded-lg bg-default/70 px-3.5 py-3">
            <span class="block text-xs text-muted">{{ t('monthly.originalPhotos') }}</span>
            <strong class="mt-1 flex items-center gap-1.5 text-sm font-semibold">
              <UIcon name="i-lucide-shield-check" class="size-4 text-success" /> {{ t('legacy.safe') }}
            </strong>
          </div>
          <div class="rounded-lg bg-default/70 px-3.5 py-3">
            <span class="block text-xs text-muted">{{ t('monthly.automaticPublications') }}</span>
            <strong class="mt-1 block text-sm font-semibold">{{ t('monthly.none') }}</strong>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap gap-2">
          <UButton
            v-if="plan.errorCode === 'QUOTA_EXCEEDED' && !planner?.paid"
            :to="`${base}/billing?reason=trial-limit`"
            icon="i-lucide-credit-card"
          >
            {{ t('monthly.choosePackage') }}
          </UButton>
          <UButton
            v-if="plan.restartable"
            icon="i-lucide-refresh-cw"
            :loading="busy"
            @click="act('restart')"
          >
            {{ t('legacy.continuePreparation') }}
          </UButton>
          <UButton
            v-if="plan.research"
            variant="outline"
            color="neutral"
            icon="i-lucide-book-open"
            @click="researchOpen = true"
          >
            {{ t('legacy.viewStrategyResearch') }}
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
                {{ recovering ? t('monthly.recoveringShort') : t('monthly.workingShort') }}
              </UBadge>
              <span class="text-xs text-muted">{{ t('monthly.leavePage') }}</span>
            </div>
            <h3 class="mt-2 text-base font-semibold text-highlighted">{{ activeCopy.title }}</h3>
            <p class="mt-1 max-w-2xl text-sm leading-6 text-muted">{{ activeCopy.description }}</p>
          </div>
        </div>
        <span class="text-sm font-medium">{{ batchCompleted }} / {{ batchTotal }} {{ t('monthly.drafts') }}</span>
      </div>

      <UProgress class="mt-5" :model-value="batchCompleted" :max="batchTotal" size="sm" />
      <div
        v-if="plan.stage === 'content'"
        class="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <strong class="text-sm text-highlighted">
            {{ t('monthly.postProgress', { current: Math.min(batchCompleted + 1, batchTotal), total: batchTotal }) }}
          </strong>
          <span class="text-xs text-muted">{{ t('monthly.noAutoRegeneration') }}</span>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <UBadge color="neutral" variant="subtle">{{ t('legacy.oneCopy') }}</UBadge>
          <UBadge color="neutral" variant="subtle">{{ t('legacy.aiImage') }}</UBadge>
          <UBadge color="neutral" variant="subtle">{{ t('legacy.check') }}</UBadge>
          <UBadge color="success" variant="subtle">{{ t('monthly.firstDraftSaved') }}</UBadge>
        </div>
      </div>
      <p
        v-if="plan.completed === 0 && plan.stage !== 'content'"
        class="mt-2 text-xs leading-5 text-muted"
      >
        {{ t('monthly.firstDraftAppears', { completed: batchCompleted, total: batchTotal }) }}
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
            <h4 class="text-sm font-semibold text-highlighted">{{ t('monthly.systemLookingFor') }}</h4>
            <p class="mt-1 text-xs leading-5 text-muted">{{ t('legacy.researchDescription') }}</p>
          </div>
        </div>
        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <div
            v-for="item in [
              t('monthly.researchTopicMarket'),
              t('monthly.researchTopicPositioning'),
              t('monthly.researchTopicGuidance'),
              t('monthly.researchTopicTiming'),
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
            <h4 class="text-sm font-semibold text-highlighted">{{ t('monthly.researchSaved') }}</h4>
            <p class="mt-0.5 text-xs leading-5 text-muted">{{ t('monthly.researchSourcesUsed', { count: plan.research.sources.length }) }}</p>
          </div>
        </div>
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          icon="i-lucide-expand"
          @click="researchOpen = true"
        >
          {{ t('legacy.openStrategyResearch') }}
        </UButton>
      </div>

      <UAlert
        v-if="!planner.workerAlive"
        class="mt-4"
        color="warning"
        variant="subtle"
        icon="i-lucide-clock"
        :title="t('monthly.workerWaitingTitle')"
        :description="t('monthly.workerWaitingDescription')"
      />
    </div>

    <div v-else-if="settled && plan" class="border-t border-default p-4">
      <div class="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-success/5 p-4">
        <div class="flex items-start gap-3">
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
          >
            <UIcon name="i-lucide-circle-check" class="size-5" />
          </div>
          <div>
            <UBadge color="success" variant="subtle">{{ t('monthly.batchReady') }}</UBadge>
            <h3 class="mt-2 text-base font-semibold text-highlighted">
              {{ t('monthly.postsAwaitingApproval', { count: batchTotal }) }}
            </h3>
            <p class="mt-1 text-sm text-muted">
              {{ t('monthly.batchReadyDescription') }}
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
            {{ t('legacy.viewStrategyResearch') }}
          </UButton>
          <UButton :to="`${base}/content`" icon="i-lucide-eye" trailing-icon="i-lucide-arrow-right">
            {{ t('monthly.viewGeneratedPosts', { count: plan.completed }) }}
          </UButton>
        </div>
      </div>
      <div
        v-if="extendable"
        class="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon name="i-lucide-sparkles" class="size-4" />
          </div>
          <div>
            <p class="text-sm font-medium text-highlighted">{{ t('monthly.generateMoreTitle') }}</p>
            <p class="text-xs text-muted">{{ t('monthly.generateMoreHint', { count: remainingPosts }) }}</p>
          </div>
        </div>
        <UInputNumber v-model="selectedQuantity" :min="1" :max="remainingPosts" class="ms-auto w-28" />
        <UButton :loading="busy" icon="i-lucide-plus" @click="openRequest('generate')">
          {{ t('monthly.generateMore', { count: selectedQuantity }) }}
        </UButton>
      </div>
      <p v-else class="mt-3 text-sm text-muted">{{ t('monthly.quotaUsedUp') }}</p>
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
            <UBadge color="success" variant="subtle">{{ t('monthly.monthReady') }}</UBadge>
            <h3 class="mt-2 text-base font-semibold text-highlighted">
              {{ t('monthly.postsAwaitingApproval', { count: plan.completed }) }}
            </h3>
            <p class="mt-1 text-sm text-muted">
              {{ t('legacy.nextContentStudio') }}
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
            {{ t('legacy.viewStrategyResearch') }}
          </UButton>
          <UButton :to="`${base}/content`" trailing-icon="i-lucide-arrow-right">
            {{ t('legacy.reviewPosts') }}
          </UButton>
          <UButton
            v-if="tiktokTargetPost"
            :to="`${base}/content/${tiktokTargetPost.id}?tiktok=1`"
            color="neutral"
            variant="outline"
            icon="i-lucide-clapperboard"
          >
            {{ t('tiktok.generateVideo') }}
          </UButton>
        </div>
      </div>
      <div
        v-if="extendable"
        class="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon name="i-lucide-sparkles" class="size-4" />
          </div>
          <div>
            <p class="text-sm font-medium text-highlighted">{{ t('monthly.generateMoreTitle') }}</p>
            <p class="text-xs text-muted">{{ t('monthly.generateMoreHint', { count: remainingPosts }) }}</p>
          </div>
        </div>
        <UInputNumber v-model="selectedQuantity" :min="1" :max="remainingPosts" class="ms-auto w-28" />
        <UButton :loading="busy" icon="i-lucide-plus" @click="openRequest('generate')">
          {{ t('monthly.generateMore', { count: selectedQuantity }) }}
        </UButton>
      </div>
    </div>

    <div v-else class="border-t border-default p-4">
      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-primary">{{ t('monthly.monthPhotos') }}</p>
        <h3 class="mt-1 text-base font-semibold text-highlighted">
          {{ t('legacy.choosePhotoQuestion') }}
        </h3>
        <p class="mt-1 max-w-2xl text-sm leading-6 text-muted">
          {{ t('legacy.originalsDescription') }}
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
              <UIcon name="i-lucide-sparkles" class="size-4 text-primary" /> {{ t('legacy.letAiChoose') }}
            </span>
            <span class="mt-1.5 block text-xs leading-5 text-muted">
              {{ t('legacy.aiChoosesDescription') }}
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
              <UIcon name="i-lucide-image-check" class="size-4 text-primary" /> {{ t('legacy.choosePhotos') }}
            </span>
            <span class="mt-1.5 block text-xs leading-5 text-muted">
              {{ t('legacy.selectedPhotoDescription') }}
            </span>
          </UButton>
        </div>
        <div class="mt-4">
          <div
            v-if="photoMode === 'auto'"
            class="rounded-xl border border-primary/20 bg-primary/5 p-3.5"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex min-w-0 items-start gap-2.5">
                <UIcon name="i-lucide-eye" class="mt-0.5 size-4 shrink-0 text-primary" />
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-highlighted">
                    {{ t('monthly.aiGalleryPreviewTitle') }}
                  </p>
                  <p class="mt-1 text-xs leading-5 text-muted">
                    {{ t('monthly.aiGalleryPreviewDescription') }}
                  </p>
                </div>
              </div>
              <UBadge color="primary" variant="subtle" class="shrink-0">
                {{ t('monthly.previewOnly') }}
              </UBadge>
            </div>
            <div
              v-if="originalPhotos.length"
              class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8"
            >
              <div
                v-for="asset in paginatedOriginalPhotos"
                :key="asset.id"
                class="relative min-w-0 overflow-hidden rounded-xl border border-default bg-elevated text-left"
                aria-disabled="true"
              >
                <MediaImage
                  :src="asset.url"
                  :alt="asset.name"
                  fit="cover"
                  class="aspect-square w-full bg-elevated"
                />
                <span class="block truncate px-2 py-1.5 text-[11px] font-medium">{{ asset.name }}</span>
                <span
                  class="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-default/90 text-muted shadow"
                  :title="t('monthly.aiPhotoPreviewOnly')"
                >
                  <UIcon name="i-lucide-lock-keyhole" class="size-3.5" />
                </span>
              </div>
            </div>
            <div
              v-if="photoTotal > photoPageSize"
              class="mt-3 flex items-center justify-end gap-2"
            >
              <UButton color="neutral" variant="outline" icon="i-lucide-chevron-left" :aria-label="t('common.previous')" :disabled="photoPage === 1" @click="photoPage--" />
              <div class="flex flex-wrap items-center justify-center gap-1" :aria-label="t('monthly.photoPage')" role="navigation">
                <UButton
                  v-for="page in photoPageCount"
                  :key="page"
                  size="xs"
                  :color="photoPage === page ? 'primary' : 'neutral'"
                  :variant="photoPage === page ? 'solid' : 'outline'"
                  :aria-current="photoPage === page ? 'page' : undefined"
                  :aria-label="`${t('monthly.photoPage')} ${page}`"
                  @click="photoPage = page"
                >
                  {{ page }}
                </UButton>
              </div>
              <UButton color="neutral" variant="outline" icon="i-lucide-chevron-right" :aria-label="t('common.next')" :disabled="photoPage === photoPageCount" @click="photoPage++" />
            </div>
          </div>

          <div v-else class="rounded-xl border border-default bg-elevated/30 p-3.5">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex min-w-0 items-start gap-2.5">
                <UIcon name="i-lucide-hand-pointer" class="mt-0.5 size-4 shrink-0 text-primary" />
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-highlighted">
                    {{ t('monthly.chooseGalleryPhotosTitle') }}
                  </p>
                  <p class="mt-1 text-xs leading-5 text-muted">
                    {{ t('monthly.chooseGalleryPhotosDescription') }}
                  </p>
                </div>
              </div>
              <UBadge color="neutral" variant="subtle" class="shrink-0">
                {{ t('monthly.clickToSelect') }}
              </UBadge>
            </div>
            <div
              v-if="originalPhotos.length"
              class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8"
            >
              <UButton
                v-for="asset in paginatedOriginalPhotos"
                :key="asset.id"
                type="button"
                color="neutral"
                variant="outline"
                class="group relative !flex w-full min-w-0 !flex-col !items-stretch !justify-start overflow-hidden rounded-xl border bg-elevated !p-0 text-left transition"
                :class="
                  selectedPhotoIds.includes(asset.id)
                    ? 'border-primary ring-2 ring-primary/20'
                    : 'border-default hover:border-primary/40 hover:shadow-sm'
                "
                :aria-pressed="selectedPhotoIds.includes(asset.id)"
                :aria-label="t('gallery.selectPhoto', { name: asset.name })"
                :disabled="
                  !selectedPhotoIds.includes(asset.id)
                    && selectedPhotoIds.length >= selectedQuantity
                "
                @click="togglePhoto(asset.id)"
              >
                <MediaImage
                  :src="asset.url"
                  :alt="asset.name"
                  fit="cover"
                  class="aspect-square w-full bg-elevated"
                />
                <span class="block truncate px-2 py-1.5 text-[11px] font-medium">{{ asset.name }}</span>
                <span
                  class="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/20 to-transparent opacity-0 transition group-hover:opacity-100"
                />
                <span
                  v-if="selectedPhotoIds.includes(asset.id)"
                  class="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-white shadow-lg"
                >
                  <UIcon name="i-lucide-check" class="size-3.5" />
                </span>
              </UButton>
            </div>
            <div
              v-if="photoTotal > photoPageSize"
              class="mt-3 flex items-center justify-end gap-2"
            >
              <UButton color="neutral" variant="outline" icon="i-lucide-chevron-left" :aria-label="t('common.previous')" :disabled="photoPage === 1" @click="photoPage--" />
              <div class="flex flex-wrap items-center justify-center gap-1" :aria-label="t('monthly.photoPage')" role="navigation">
                <UButton
                  v-for="page in photoPageCount"
                  :key="page"
                  size="xs"
                  :color="photoPage === page ? 'primary' : 'neutral'"
                  :variant="photoPage === page ? 'solid' : 'outline'"
                  :aria-current="photoPage === page ? 'page' : undefined"
                  :aria-label="`${t('monthly.photoPage')} ${page}`"
                  @click="photoPage = page"
                >
                  {{ page }}
                </UButton>
              </div>
              <UButton color="neutral" variant="outline" icon="i-lucide-chevron-right" :aria-label="t('common.next')" :disabled="photoPage === photoPageCount" @click="photoPage++" />
            </div>
          </div>

          <UAlert
            v-if="!originalPhotos.length"
            class="mt-3"
            color="warning"
            variant="subtle"
            :title="t('monthly.noOriginalPhotosTitle')"
            :description="t('monthly.noOriginalPhotosDescription')"
          />
          <p v-if="photoMode === 'selected' && selectedPhotoIds.length" class="mt-2 text-xs text-muted">
            {{ t('monthly.photosIncluded', { count: selectedPhotoIds.length }) }}
            <template v-if="selectedPhotoIds.length >= selectedQuantity">
              · {{ t('monthly.photoLimitReached', { count: selectedQuantity }) }}
            </template>
          </p>
        </div>
      </div>

      <div
        class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4"
      >
        <div>
          <h3 class="text-sm font-semibold text-highlighted">
            {{ extendable ? t('monthly.generateMoreTitle') : t('monthly.readyToPrepare') }}
          </h3>
          <p class="mt-1 max-w-xl text-sm leading-6 text-muted">
            {{ t('legacy.monthlyProcess') }}
          </p>
        </div>
        <div class="grid w-full gap-3 md:grid-cols-3">
          <div class="flex min-w-0 items-center gap-3 rounded-xl border border-default bg-default px-4 py-3">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UIcon name="i-lucide-sparkles" class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-highlighted">{{ t('monthly.quantityLabel') }}</p>
              <p class="text-xs text-muted">{{ t('monthly.quantityRemaining', { count: remainingPosts }) }}</p>
            </div>
            <UInputNumber v-model="selectedQuantity" :min="1" :max="remainingPosts" class="w-24 shrink-0" />
          </div>
          <div class="flex min-w-0 items-center gap-3 rounded-xl border border-default bg-default px-4 py-3">
            <UIcon name="i-lucide-clapperboard" class="size-5 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-highlighted">{{ t('tiktok.includeVideos') }}</p>
              <p class="truncate text-xs text-muted">{{ t('tiktok.includeVideosHint') }}</p>
            </div>
            <UInputNumber
              v-model="selectedVideoQuantity"
              :min="0"
              :max="selectedQuantity"
              class="w-24 shrink-0"
              :aria-label="t('tiktok.videoQuantity')"
            />
          </div>
          <div class="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">{{ t('monthly.readyToPrepare') }}</p>
              <p class="text-xs text-muted">{{ t('monthly.quantityRemaining', { count: remainingPosts }) }}</p>
            </div>
            <UButton :loading="busy" :disabled="remainingPosts < 1" icon="i-lucide-calendar-plus" @click="openRequest('prepare')">
              {{ extendable ? t('monthly.generateMore', { count: selectedQuantity }) : t('legacy.prepareMonth') }}
            </UButton>
          </div>
        </div>
      </div>
    </div>

    <UModal
      v-model:open="requestOpen"
      :title="singlePost ? t('monthly.requestSingleTitle') : t('monthly.requestSplitTitle')"
      :description="
        singlePost
          ? t('monthly.requestSingleDescription')
          : t('monthly.requestSplitDescription', { count: selectedQuantity })
      "
    >
      <template #body>
        <div v-if="singlePost" class="grid grid-cols-2 gap-3">
          <UButton
            v-for="option in channelOptions"
            :key="option.value"
            block
            size="xl"
            :color="channelSplit[option.value] === 1 ? 'primary' : 'neutral'"
            :variant="channelSplit[option.value] === 1 ? 'soft' : 'outline'"
            :aria-pressed="channelSplit[option.value] === 1"
            class="h-auto flex-col gap-3 py-6"
            @click="chooseSingleChannel(option.value)"
          >
            <UIcon :name="option.icon" class="size-12" />
            <span class="text-sm font-semibold">{{ option.label }}</span>
          </UButton>
        </div>
        <div v-else class="grid grid-cols-2 gap-3">
          <UCard
            v-for="option in channelOptions"
            :key="option.value"
            :ui="{ body: 'p-4' }"
            :class="channelSplit[option.value] > 0 ? 'ring-1 ring-primary' : ''"
          >
            <div class="flex flex-col items-center gap-3 text-center">
              <UIcon :name="option.icon" class="size-8" />
              <span class="text-sm font-semibold text-highlighted">{{ option.label }}</span>
              <UInputNumber
                :model-value="channelSplit[option.value]"
                :min="0"
                :max="selectedQuantity"
                class="w-28"
                :aria-label="t('monthly.postsForChannel', { channel: option.label })"
                @update:model-value="setChannelCount(option.value, Number($event))"
              />
            </div>
          </UCard>
        </div>
        <p
          v-if="!singlePost"
          class="mt-3 text-sm"
          :class="splitComplete ? 'text-muted' : 'text-error'"
        >
          {{ t('monthly.splitAssigned', { assigned: splitAssigned, total: selectedQuantity }) }}
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="requestOpen = false">
            {{ t('common.cancel') }}
          </UButton>
          <UButton :loading="busy" :disabled="!splitComplete" @click="confirmRequest">
            {{
              requestAction === 'prepare'
                ? t('legacy.prepareMonth')
                : t('monthly.generateMore', { count: selectedQuantity })
            }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="resetOpen"
      :title="t('monthly.resetTitle')"
      :description="t('monthly.resetDescription')"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          :title="t('monthly.resetWarningTitle')"
          :description="t('monthly.resetWarningDescription')"
        />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="busy" @click="resetOpen = false"
            >{{ t('common.cancel') }}</UButton
          >
          <UButton color="error" icon="i-lucide-rotate-ccw" :loading="busy" @click="act('reset')"
            >{{ t('monthly.clearStartAgain') }}</UButton
          >
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="researchOpen"
      fullscreen
      :title="t('monthly.planResearchTitle')"
      :description="t('monthly.planResearchDescription')"
    >
      <template #body>
        <div class="mx-auto w-full max-w-6xl space-y-8 py-2 sm:py-6">
          <div class="flex flex-col justify-between gap-4 rounded-2xl border border-primary/15 bg-primary/5 p-4 sm:flex-row sm:items-center">
            <div>
              <p class="text-sm font-semibold text-highlighted">{{ t('monthly.reportTitle') }}</p>
              <p class="mt-1 text-sm leading-6 text-muted">{{ t('monthly.reportDescription') }}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-if="plan?.research"
                color="neutral"
                variant="outline"
                icon="i-lucide-file-text"
                @click="openReport('research')"
              >
                {{ t('monthly.exportResearchPdf') }}
              </UButton>
              <UButton
                v-if="plan?.strategy"
                color="primary"
                variant="solid"
                icon="i-lucide-file-down"
                @click="openReport('strategy')"
              >
                {{ t('monthly.exportStrategyPdf') }}
              </UButton>
            </div>
          </div>
          <div class="grid gap-4 sm:grid-cols-3">
            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <span class="text-xs font-medium text-muted">{{ t('common.status') }}</span>
              <strong class="mt-2 flex items-center gap-2 text-sm font-semibold text-highlighted">
                <UIcon name="i-lucide-circle-check" class="size-4 text-success" />
                {{ t('legacy.researchComplete') }}
              </strong>
            </div>
            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <span class="text-xs font-medium text-muted">{{ t('monthly.sourcesConsulted') }}</span>
              <strong class="mt-1.5 block text-lg font-semibold text-highlighted">
                {{ plan?.research?.sources.length || 0 }}
              </strong>
            </div>
            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <span class="text-xs font-medium text-muted">{{ t('monthly.usage') }}</span>
              <strong class="mt-2 block text-sm font-semibold text-highlighted">
                {{ t('monthly.usageDetails') }}
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
