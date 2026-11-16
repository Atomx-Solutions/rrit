<script setup lang="ts">
import type { PublishingChannel } from '~~/shared/schemas/channel-format'
import { maxVideoPhotos } from '~~/shared/schemas/storyboard'
import type { PlannerRequestChoice } from './PlannerRequestModal.vue'
const props = defineProps<{ month: string }>()
const { t } = useI18n()
const { data: workspace, base, initLive, syncing } = useWorkspace()
const {
  data: planner,
  error: loadError,
  refresh,
} = useMonthlyPlannerData()

const busy = ref(false)
const error = ref('')
const { showError, watchError } = useFormFeedback()
watchError(error)
watch(loadError, (value) => {
  if (value) showError(t('monthly.serverUnavailableDescription'), 'warning')
}, { immediate: true })
const researchOpen = ref(false)
// The plan window covers the whole page, so Back is read as closing it: the
// page stays and the window closes. Without this the address changed while
// the window stayed on screen over the page Back led to.
onBeforeRouteLeave(() => {
  if (!researchOpen.value) return
  researchOpen.value = false
  return false
})
const resetOpen = ref(false)
// A follow-up batch gets its own photo decision. It must not inherit the
// first batch's allow-list, otherwise a customer cannot use newer or simply
// different owned photographs for the next post.
const configuringMore = ref(false)
const originalPhotos = computed(() =>
  workspace.value.assets
    .filter((asset) => asset.kind === 'photo' && asset.rights && !asset.generated)
)
// What a tap on a photograph assigns it to. Only asked when the request has
// videos; otherwise every photograph chosen is for a post.
const pickFor = ref<'post' | 'video'>('post')
// A chosen photograph opened large, from the video header.
// The open video's photographs are browsed together, so the arrows step
// through them in the order the video uses them.
const preview = ref<{ ids: string[]; index: number } | null>(null)
const previewPhoto = computed(() => {
  const id = preview.value?.ids[preview.value.index]
  const asset = id ? photoById(id) : undefined
  return asset ? { url: asset.url, name: asset.name } : null
})
function movePreview(step: number) {
  if (!preview.value) return
  const count = preview.value.ids.length
  preview.value = { ...preview.value, index: (preview.value.index + step + count) % count }
}
// Photographs no video has taken yet. When the open video has none and this is
// empty, every photograph is already in another video and the form says how
// to get out of it instead of leaving the button pointing at nothing.
const freeVideoPhotos = computed(() =>
  originalPhotos.value.filter((asset) => !videoGroups.value.some((group) => group.includes(asset.id))))
function photoById(id: string) {
  return originalPhotos.value.find((asset) => asset.id === id)
}
const selectedPhotoIds = ref<string[]>([
  ...(planner.value?.photoPreference?.selectedAssetIds || []),
].filter((id) => originalPhotos.value.some((asset) => asset.id === id)))
// A video is a deliverable of its own, chosen apart from the feed posts. Each
// video is a group of photographs of one subject: the first is the main one it
// closes on and shows as its poster, the rest are further angles, one scene
// each, up to maxVideoPhotos. The group being filled is the active card.
const videoGroups = ref<string[][]>(
  (planner.value?.photoPreference?.selectedVideoAssetIds || []).map((id) => [
    id,
    ...(planner.value?.photoPreference?.videoExtraAssetIds?.[id] || []),
  ]),
)
const activeVideo = ref(0)
// Choosing nothing leaves the photographs to the AI; choosing any means the
// business picks them, so there is no separate question to answer first.
const photoMode = computed<'auto' | 'selected'>(() =>
  selectedPhotoIds.value.length || videoGroups.value.some((group) => group.length) ? 'selected' : 'auto')
// The plan loads after the first paint; take its saved photo choices once it
// arrives, unless the customer already started choosing.
let photoPreferenceApplied = false
watch(
  () => planner.value?.photoPreference,
  (preference) => {
    if (!preference || photoPreferenceApplied) return
    photoPreferenceApplied = true
    if (selectedPhotoIds.value.length || videoGroups.value.length) return
    const allowed = new Set(originalPhotos.value.map((asset) => asset.id))
    selectedPhotoIds.value = (preference.selectedAssetIds || []).filter((id) => allowed.has(id))
    videoGroups.value = (preference.selectedVideoAssetIds || [])
      .map((id) => [id, ...(preference.videoExtraAssetIds?.[id] || [])].filter((item) => allowed.has(item)))
      .filter((group) => group.length)
  },
  { immediate: true },
)
const selectedVideoPhotoIds = computed(() => videoGroups.value.filter((group) => group.length).map((group) => group[0]!))
const videoExtraAssetIds = computed(() => Object.fromEntries(
  videoGroups.value.filter((group) => group.length > 1).map((group) => [group[0]!, group.slice(1)]),
))
watch(
  originalPhotos,
  (photos) => {
    const allowed = new Set(photos.map((photo) => photo.id))
    selectedPhotoIds.value = selectedPhotoIds.value.filter((id) => allowed.has(id))
    videoGroups.value = videoGroups.value.map((group) => group.filter((id) => allowed.has(id)))
  },
  { immediate: true },
)
function videoCardOf(id: string) {
  return videoGroups.value.findIndex((group) => group.includes(id))
}
function photoRoleFull(kind: 'post' | 'video') {
  return kind === 'video'
    ? activeVideo.value >= selectedVideoQuantity.value
      || (videoGroups.value[activeVideo.value]?.length || 0) >= maxVideoPhotos
    : selectedPhotoIds.value.length >= selectedQuantity.value
}
function configureMore() {
  configuringMore.value = true
  selectedPhotoIds.value = []
  videoGroups.value = []
  activeVideo.value = 0
}
// The two choices are independent, so each has its own control on the tile. A
// photograph carrying both produces a feed post and a TikTok video from the
// same source. Choosing more than the month will produce is a selection the
// planner has to reject later, so a full role refuses the click while the
// person can still act on it.
// How a photograph looks in the strip for the tab in use. On the video tab it
// belongs to the video being filled, to another video (locked, marked with
// that video), or to none. Its badge is the order within the video, the first
// being the main one.
function tileChosen(id: string) {
  return pickFor.value === 'video'
    ? videoCardOf(id) === activeVideo.value
    : selectedPhotoIds.value.includes(id)
}
function tileLocked(id: string) {
  if (tileChosen(id)) return false
  if (pickFor.value === 'video' && videoCardOf(id) >= 0) return true
  return photoRoleFull(pickFor.value)
}
function tileBadge(id: string) {
  if (pickFor.value === 'post') return selectedPhotoIds.value.includes(id) ? '✓' : ''
  const card = videoCardOf(id)
  if (card < 0) return ''
  return card === activeVideo.value
    ? String((videoGroups.value[card]?.indexOf(id) ?? 0) + 1)
    : `V${card + 1}`
}
function togglePhoto(id: string, kind: 'post' | 'video') {
  if (kind === 'video') {
    const card = videoCardOf(id)
    if (card >= 0 && card !== activeVideo.value) return
    if (card >= 0) {
      videoGroups.value = videoGroups.value.map((group, index) => index === card ? group.filter((item) => item !== id) : group)
      return
    }
    if (photoRoleFull('video')) return
    const groups = [...videoGroups.value]
    while (groups.length <= activeVideo.value) groups.push([])
    // The video stays open after a tap, so it can take more than one
    // photograph; the main button and the arrow move on to the next video.
    groups[activeVideo.value] = [...groups[activeVideo.value]!, id]
    videoGroups.value = groups
    return
  }
  const list = selectedPhotoIds
  if (list.value.includes(id)) {
    list.value = list.value.filter((item) => item !== id)
    return
  }
  if (photoRoleFull(kind)) return
  list.value = [...list.value, id]
}

// The export buttons download the PDF the server already builds, instead of
// opening the report page in a tab to save it from there.
const exporting = ref<'research' | 'strategy' | null>(null)
async function downloadReport(type: 'research' | 'strategy') {
  if (!import.meta.client || exporting.value) return
  exporting.value = type
  try {
    const response = await fetch(
      `/api/ai/monthly-report.pdf?month=${encodeURIComponent(props.month)}&type=${type}`,
      { credentials: 'include' },
    )
    if (!response.ok) throw new Error('report download failed')
    saveFile(await response.blob(), `framic-${type}-${props.month}`, 'application/pdf')
  } catch {
    error.value = t('monthly.reportDownloadFailed')
  } finally {
    exporting.value = null
  }
}

function prerequisitePath(id: string) {
  if (id === 'owned-photo') return `${base.value}/gallery?upload=1&focus=rights&attention=planner`
  const section = id === 'industry' || id === 'audience' ? id : 'facts'
  return `${base.value}/brand?focus=${id}&required=1&attention=planner#${section}`
}

function prerequisiteMessageKey(code: string | null | undefined) {
  if (code === 'BUSINESS_CONTEXT_REQUIRED') return 'monthly.prerequisiteBusinessContext'
  if (code === 'VERIFIED_FACTS_REQUIRED') return 'monthly.prerequisiteVerifiedFacts'
  if (code === 'OWNED_PHOTOS_REQUIRED') return 'monthly.prerequisiteOwnedPhotos'
  return 'monthly.prerequisiteDefault'
}

const phases = [
  { key: 'research', label: t('monthly.phaseResearch'), description: t('monthly.phaseResearchDescription') },
  { key: 'planning', label: t('monthly.phaseStrategy'), description: t('monthly.phaseStrategyDescription') },
  { key: 'content', label: t('monthly.phaseContent'), description: t('monthly.phaseContentDescription') },
] as const

const plan = computed(() => planner.value?.plan)
// Keep both deliverable counters opt-in. A new request should not silently
// reserve a static photo post before the customer chooses its quantity.
const selectedQuantity = ref(0)
const selectedVideoQuantity = ref(0)
const requestOpen = ref(false)
const requestAction = ref<'prepare' | 'generate'>('prepare')
// What the business chose in the request window: each post's and video's
// platform, and each video's music.
const requestChoice = ref<PlannerRequestChoice>({ posts: [], videos: [] })
// Platforms with no posts are left out entirely: zero is the absence of a
// request for that platform, not a request for none.
function channelCounts(channels: PublishingChannel[]) {
  const counts: Partial<Record<PublishingChannel, number>> = {}
  for (const channel of channels) counts[channel] = (counts[channel] || 0) + 1
  return counts
}
// When the business chooses the photographs, every post and every video it
// asks for needs one of its own: a request is not sent with deliverables left
// for photographs nobody picked.
const postPhotosMissing = computed(() =>
  photoMode.value === 'selected' ? Math.max(0, selectedQuantity.value - selectedPhotoIds.value.length) : 0)
const videoPhotosMissing = computed(() => photoMode.value === 'selected'
  ? Array.from({ length: selectedVideoQuantity.value }, (_, index) => index)
    .filter((index) => !videoGroups.value[index]?.length).length
  : 0)
function openRequest(action: 'prepare' | 'generate') {
  // A video-only batch does not need a post photo; a post-only batch does not
  // need a video photo. The guard fires only when the user is in `selected`
  // mode and has picked neither.
  if (
    (action === 'prepare' || action === 'generate') &&
    photoMode.value === 'selected' &&
    !selectedPhotoIds.value.length &&
    !selectedVideoPhotoIds.value.length
  ) {
    error.value = t('monthly.selectPhotoRequired')
    return
  }
  requestAction.value = action
  requestOpen.value = true
}
async function confirmRequest(choice: PlannerRequestChoice) {
  requestChoice.value = choice
  requestOpen.value = false
  await act(requestAction.value)
}
const remainingPosts = computed(() => planner.value?.usage?.remaining || 0)
// A video is a deliverable of its own with its own photograph, so the only
// bound on it is the videos the package has left; it does not borrow a post.
const remainingVideos = computed(() => planner.value?.videoUsage?.remaining || 0)
// How many of the business's videos are made at once; while some wait, the
// rendering status says how many are queued.
const videosAtOnce = computed(() => planner.value?.videosAtOnce || 0)
const maxVideosThisBatch = computed(() => remainingVideos.value)
watch(maxVideosThisBatch, (max) => {
  if (selectedVideoQuantity.value > max) selectedVideoQuantity.value = max
})
// A first visit starts at one post, so the form never opens on an empty 0
// with nothing to press; the package may still allow more.
let quantityDefaulted = false
watch(remainingPosts, (remaining) => {
  if (!quantityDefaulted && remaining > 0 && selectedQuantity.value === 0 && selectedVideoQuantity.value === 0) {
    quantityDefaulted = true
    selectedQuantity.value = 1
  }
  // Zero images is a valid request when at least one video is also asked for,
  // so the clamp floors at 0 and ceilings at whatever the package still has.
  selectedQuantity.value = Math.max(0, Math.min(selectedQuantity.value, remaining))
}, { immediate: true })
// Lowering a count leaves photos chosen that no longer have a deliverable to go
// with, so the extras are released rather than left to fail at submission.
// The tab follows the kinds the request still makes.
watch([selectedQuantity, selectedVideoQuantity], ([posts, videos]) => {
  if (!videos) pickFor.value = 'post'
  else if (!posts) pickFor.value = 'video'
}, { immediate: true })
watch(selectedVideoQuantity, (quantity) => {
  if (videoGroups.value.length > quantity) videoGroups.value = videoGroups.value.slice(0, quantity)
  if (activeVideo.value >= quantity) activeVideo.value = Math.max(0, quantity - 1)
})
watch(selectedQuantity, (quantity) => {
  if (selectedPhotoIds.value.length > quantity)
    selectedPhotoIds.value = selectedPhotoIds.value.slice(0, quantity)
})
const active = computed(() => ['queued', 'running'].includes(plan.value?.status || ''))
const blocked = computed(() => plan.value?.status === 'blocked')
const ready = computed(() => plan.value?.status === 'review')
// Everything the customer asked for is produced, and the package still owes
// posts. This is a resting state with two next steps: look at what arrived, or
// ask for more.
const settled = computed(() => plan.value?.status === 'idle' && (plan.value?.completed || 0) > 0)
// Videos render after their posts are committed, so the batch is only ready
// for review once none of them is still being made.
const videosRendering = computed(() => plan.value?.videosRendering || 0)
// Videos of the plan still waiting their turn behind the ones being made.
const videosQueued = computed(() => plan.value?.videosQueued || 0)
// A plan that produced everything asked of it but still owes posts from the
// package. Posts are drawn on request, so this is a normal resting state, not
// an end state.
const extendable = computed(
  () => !!plan.value?.extendable && (remainingPosts.value > 0 || remainingVideos.value > 0),
)
// The button on "Gjenero edhe postime" names exactly what the user is about to
// get: a video-only request should read "Gjenero N video", a post-only request
// should read "Gjenero N postime", and a mixed request names both counts.
const generateMoreLabel = computed(() => {
  const posts = selectedQuantity.value
  const videos = selectedVideoQuantity.value
  const postText = t(posts === 1 ? 'monthly.countPostsOne' : 'monthly.countPosts', { count: posts })
  const videoText = t(videos === 1 ? 'monthly.countVideosOne' : 'monthly.countVideos', { count: videos })
  if (posts > 0 && videos > 0)
    return t('monthly.createItems', { items: t('monthly.itemsAnd', { first: postText, second: videoText }) })
  if (videos > 0 && posts === 0) return t('monthly.createItems', { items: videoText })
  return t('monthly.createItems', { items: postText })
})
// The one thing still missing, in the order a person fills the form: a count,
// then the post photographs, then each video's photograph. The main button
// names it and takes the person there, so the form never asks them to work
// out the next step.
const nextStep = computed<
  | { kind: 'count' }
  | { kind: 'post'; missing: number }
  | { kind: 'video'; index: number }
  | { kind: 'upload' }
  | { kind: 'ready' }
>(() => {
  if (selectedQuantity.value + selectedVideoQuantity.value < 1) return { kind: 'count' }
  if (postPhotosMissing.value > 0) return { kind: 'post', missing: postPhotosMissing.value }
  if (videoPhotosMissing.value > 0) {
    const index = Array.from({ length: selectedVideoQuantity.value }, (_, item) => item)
      .find((item) => !videoGroups.value[item]?.length) ?? 0
    // Every photograph is already in another video: the way on is more photos.
    if (!freeVideoPhotos.value.length) return { kind: 'upload' }
    return { kind: 'video', index }
  }
  return { kind: 'ready' }
})
const nextStepLabel = computed(() => {
  const step = nextStep.value
  if (step.kind === 'count') return t('monthly.nextChooseCount')
  if (step.kind === 'post')
    return t(step.missing === 1 ? 'monthly.nextPostPhotoOne' : 'monthly.nextPostPhotos', { count: step.missing })
  if (step.kind === 'video') return t('monthly.nextVideoPhoto', { number: step.index + 1 })
  if (step.kind === 'upload') return t('monthly.addPhotos')
  return generateMoreLabel.value
})
const photoTile = ref<HTMLElement | null>(null)
function runNextStep() {
  const step = nextStep.value
  if (step.kind === 'ready') {
    openRequest(configuringMore.value ? 'generate' : 'prepare')
    return
  }
  if (step.kind === 'upload') {
    void navigateTo(`${base.value}/gallery?upload=1`)
    return
  }
  if (step.kind === 'count') {
    document.querySelector<HTMLInputElement>('#planner-post-count input')?.focus()
    return
  }
  if (step.kind === 'post') pickFor.value = 'post'
  else {
    pickFor.value = 'video'
    activeVideo.value = step.index
  }
  photoTile.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
// Finishing the post photographs opens the video tab by itself, on the first
// video that still has none.
watch(() => selectedPhotoIds.value.length, (count, previous) => {
  if (count > previous && count >= selectedQuantity.value && selectedVideoQuantity.value > 0) {
    pickFor.value = 'video'
    const empty = Array.from({ length: selectedVideoQuantity.value }, (_, item) => item)
      .find((item) => !videoGroups.value[item]?.length)
    if (empty !== undefined) activeVideo.value = empty
  }
})
// Progress is measured against what the customer asked for, not against the
// month's whole quota: asking for one post and being shown "0 / 11" reports a
// job eleven times larger than the one running.
const batchTotal = computed(() => plan.value?.batch?.total || plan.value?.requested || plan.value?.total || 0)
// Names what is waiting by kind: a video-only batch is not "posts".
// The card counts this plan's posts as they are now, by the same rule as the
// posts list: one whose video failed, or whose publishing failed, is failed;
// a draft or a post sent for approval is waiting for the business.
const planPosts = computed(() =>
  workspace.value.posts.filter((post) => plan.value && post.aiProvenance?.planId === plan.value.id),
)
const isFailed = (post: (typeof workspace.value.posts)[number]) => post.video?.status === 'failed' || post.status === 'failed'
const waitingPosts = computed(() =>
  planPosts.value.filter((post) => ['draft', 'review'].includes(post.status) && !isFailed(post)),
)
const waitingVideos = computed(() => waitingPosts.value.filter((post) => post.video).length)
const waitingStills = computed(() => waitingPosts.value.length - waitingVideos.value)
const failedPlanPosts = computed(() => planPosts.value.filter(isFailed).length)
const onlyFailedVideos = computed(() => !waitingPosts.value.length && failedPlanPosts.value > 0)
const reviewPath = computed(() => `${base.value}/content${onlyFailedVideos.value ? '?status=failed' : ''}`)
// One or several of something, each worded in its own language.
const counted = (key: string, count: number) => t(`${key}${count === 1 ? 'One' : 'Many'}`, { count })
const awaitingTitle = computed(() => {
  if (videosRendering.value)
    return t(videosRendering.value === 1 ? 'monthly.videoRenderingTitleOne' : 'monthly.videoRenderingTitleMany', { count: videosRendering.value })
  if (onlyFailedVideos.value) return counted('monthly.videosFailedTitle', failedPlanPosts.value)
  if (waitingVideos.value && waitingStills.value)
    return t('monthly.mixedAwaitingApproval', {
      posts: counted('monthly.postCount', waitingStills.value),
      videos: counted('monthly.videoCount', waitingVideos.value),
    })
  if (waitingVideos.value) return counted('monthly.videosAwaitingApproval', waitingVideos.value)
  if (waitingStills.value) return counted('monthly.postsAwaitingApproval', waitingStills.value)
  return t('monthly.batchReady')
})
// Produced within the running request, so a second request for one post starts
// again at zero instead of continuing the month's running total.
const batchCompleted = computed(() =>
  Math.max(0, Math.min(plan.value?.batch?.completed ?? plan.value?.completed ?? 0, batchTotal.value)),
)
// The posts of the request in work or just finished, oldest first: the plan's
// newest posts, as many as the request has produced.
const batchPosts = computed(() =>
  [...planPosts.value]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, batchCompleted.value)
    .reverse(),
)
// Videos still rendering keep the progress view: the request is not done until
// they are, and the form to ask for more would only get in the way.
const working = computed(() => active.value || videosRendering.value > 0)
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
  if (ready.value && !videosRendering.value) return phases.length
  if (!active.value && videosRendering.value) return phases.length - 1
  return Math.max(
    0,
    phases.findIndex((phase) => phase.key === plan.value?.stage),
  )
})

const activeCopy = computed(() => {
  if (!active.value && videosRendering.value)
    return {
      title: t(videosRendering.value === 1 ? 'monthly.videoRenderingTitleOne' : 'monthly.videoRenderingTitleMany', { count: videosRendering.value }),
      description: t(videosRendering.value === 1 ? 'monthly.videoRenderingDescriptionOne' : 'monthly.videoRenderingDescriptionMany'),
    }
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
      description: t(plan.value?.error || 'monthly.failureDefaultDescription'),
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
  if (
    action === 'prepare' &&
    photoMode.value === 'selected' &&
    !selectedPhotoIds.value.length &&
    !selectedVideoPhotoIds.value.length
  ) {
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
        ...(action === 'prepare' || action === 'generate'
          ? {
              photoMode: photoMode.value,
              selectedAssetIds: photoMode.value === 'selected' ? selectedPhotoIds.value : [],
              selectedVideoAssetIds:
                photoMode.value === 'selected' ? selectedVideoPhotoIds.value : [],
              videoExtraAssetIds: photoMode.value === 'selected' ? videoExtraAssetIds.value : {},
              quantity: selectedQuantity.value,
              channelCounts: channelCounts(requestChoice.value.posts),
              videoChannelCounts: channelCounts(requestChoice.value.videos.map((video) => video.channel)),
              videoQuantity: selectedVideoQuantity.value,
              ...(selectedVideoQuantity.value ? { videoMusic: requestChoice.value.videos } : {}),
            }
          : {}),
      },
      retry: 0,
    })
    await refresh()
    if (action === 'generate') configuringMore.value = false
    if (action === 'reset') {
      resetOpen.value = false
      selectedPhotoIds.value = []
      videoGroups.value = []
      activeVideo.value = 0
      await initLive()
    }
  } catch (problem) {
    const failure = problem as { data?: { message?: string; data?: { code?: string } } }
    // A trial that has used its 3 posts continues by choosing a package.
    if (failure.data?.data?.code === 'QUOTA_EXCEEDED' && !planner.value?.paid) {
      await navigateTo(`${unref(base)}/billing?reason=trial-limit`)
      return
    }
    error.value = t(failure.data?.message || 'monthly.changeNotSaved')
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
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-1 basis-64 items-start gap-3.5">
          <div
            class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <UIcon name="i-lucide-calendar-range" class="size-4" />
          </div>
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-highlighted">
              {{ t('monthly.heading') }}
            </h2>
            <p v-if="planner" class="mt-1 max-w-2xl text-xs leading-5 text-muted">
              {{ t('monthly.description') }}
            </p>
            <p v-else class="mt-1 text-sm text-muted">{{ t('monthly.checkingService') }}</p>
          </div>
        </div>
        <!-- Small and to the side: starting over clears drafts, so it stays
             at hand without leading the page. -->
        <div v-if="plan && plan.status !== 'cancelled'" class="flex shrink-0 items-center gap-2">
          <UButton
            v-if="active"
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-pause"
            :loading="busy"
            @click="act('pause')"
          >
            {{ t('legacy.pause') }}
          </UButton>
          <UButton
            color="error"
            variant="outline"
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
            <p class="mt-1 text-sm text-muted">{{ t(prerequisiteMessageKey(planner.prerequisiteCode)) }}</p>
            <div v-if="planner.prerequisites?.length" class="mt-3 space-y-2">
              <p class="text-xs font-semibold uppercase tracking-wide text-warning">
                Plotëso këto para gjenerimit
              </p>
              <ULink
                v-for="item in planner.prerequisites"
                :key="item.id"
                :to="prerequisitePath(item.id)"
                class="group block rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 transition-colors hover:bg-warning/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <div class="flex items-start justify-between gap-3">
                  <p class="text-sm font-medium text-highlighted">{{ t(item.labelKey) }}</p>
                  <UIcon name="i-lucide-arrow-up-right" class="mt-0.5 size-4 shrink-0 text-muted transition-colors group-hover:text-primary" />
                </div>
                <p class="mt-0.5 text-xs leading-5 text-muted">{{ t(item.descriptionKey) }}</p>
              </ULink>
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

    <div v-else-if="working && plan" class="border-t border-default p-4" aria-live="polite">
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
                {{ recovering ? t('monthly.recoveringShort') : !active ? t('monthly.videoRendering') : t('monthly.workingShort') }}
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

      <div v-if="batchPosts.length" class="mt-6">
        <PlannerBatchList :posts="batchPosts" :working="active" />
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
        v-if="plan.research && plan.stage !== 'content'"
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
          class="shrink-0"
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

    <div v-else-if="settled && plan && !configuringMore" class="border-t border-default p-4">
      <!-- Two cards, each with its own job: asking for more on one side, what
           is ready on the other. Side by side on a wide screen, stacked on a
           phone with "generate more" first. -->
      <div class="grid gap-3 lg:grid-cols-2">
        <section
          v-if="extendable && !videosRendering"
          class="flex flex-col gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4"
        >
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UIcon name="i-lucide-wand-sparkles" class="size-4" />
            </div>
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-highlighted">{{ t('monthly.generateMoreTitle') }}</h3>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <UFormField :label="t('monthly.postSelectionCount', { selected: selectedQuantity, total: remainingPosts })" size="xs" class="min-w-0">
              <LiveInputNumber v-model="selectedQuantity" size="lg" :min="0" :max="remainingPosts" class="w-full" />
            </UFormField>
            <UFormField :label="t('monthly.videoSelectionCount', { selected: selectedVideoQuantity, total: remainingVideos })" size="xs" class="min-w-0">
              <LiveInputNumber
v-model="selectedVideoQuantity"
                size="lg"
                :min="0"
                :max="maxVideosThisBatch"
                class="w-full"
                :aria-label="t('video.quantity')"
              />
            </UFormField>
          </div>
          <UButton
            class="mt-auto w-full justify-center whitespace-nowrap"
            :loading="busy"
            :disabled="selectedQuantity + selectedVideoQuantity < 1"
            icon="i-lucide-plus"
            @click="configureMore"
          >
            {{ generateMoreLabel }}
          </UButton>
        </section>
        <!-- Only an exhausted package says so; while a video is still being
             made the package may well have more left. -->
        <section
          v-else-if="!videosRendering && remainingPosts < 1 && remainingVideos < 1"
          class="flex items-center gap-3 rounded-xl border border-default p-4 text-sm text-muted"
        >
          <UIcon name="i-lucide-package-check" class="size-5 shrink-0" />
          {{ t('monthly.quotaUsedUp') }}
        </section>

        <section class="flex flex-col gap-4 rounded-xl border border-success/20 bg-success/5 p-4">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
              <UIcon
                :name="videosRendering ? 'i-lucide-loader' : 'i-lucide-circle-check'"
                :class="['size-5', videosRendering && 'animate-spin']"
              />
            </div>
            <div class="min-w-0">
              <UBadge :color="videosRendering ? 'neutral' : onlyFailedVideos ? 'warning' : 'success'" variant="subtle" size="sm">
                {{ videosRendering ? t('monthly.videoRendering') : onlyFailedVideos ? t('status.videoFailed') : t('monthly.batchReady') }}
              </UBadge>
              <h3 class="mt-2 text-base font-semibold text-highlighted">
                {{ awaitingTitle }}
              </h3>
              <p class="mt-0.5 text-sm text-muted">
                {{ videosRendering ? t(videosRendering === 1 ? 'monthly.videoRenderingDescriptionOne' : 'monthly.videoRenderingDescriptionMany') : onlyFailedVideos ? t('video.failedBlocksDescription') : t('monthly.batchReadyDescription') }}
              </p>
              <p v-if="videosRendering && videosQueued && videosAtOnce" class="mt-1 inline-flex items-center gap-1 text-sm text-muted">
                <UIcon name="i-lucide-clock" class="size-4" />{{ t(videosAtOnce === 1 ? 'monthly.videosQueuedOne' : 'monthly.videosQueuedMany', { queued: videosQueued, count: videosAtOnce }) }}
              </p>
              <ULink
                v-if="!videosRendering && !onlyFailedVideos && failedPlanPosts"
                :to="`${base}/content?status=failed`"
                class="mt-1 inline-flex items-center gap-1 text-sm font-medium text-warning"
              >
                <UIcon name="i-lucide-video-off" class="size-4" />{{ counted('monthly.someFailed', failedPlanPosts) }}
              </ULink>
            </div>
          </div>
          <div class="mt-auto flex gap-2">
            <UButton
              v-if="plan.research"
              variant="outline"
              color="success"
              icon="i-lucide-book-open"
              class="flex-1 justify-center whitespace-nowrap rounded-md bg-default"
              @click="researchOpen = true"
            >
              {{ t('legacy.viewStrategyResearch') }}
            </UButton>
            <UButton
              v-if="!videosRendering"
              class="flex-1 justify-center whitespace-nowrap"
              :color="onlyFailedVideos ? 'warning' : 'success'"
              :to="reviewPath"
              trailing-icon="i-lucide-arrow-right"
            >
              {{ t('legacy.reviewPosts') }}
            </UButton>
          </div>
        </section>
      </div>
      <!-- The drafts run under both cards, full width, so neither card grows
           taller than the other and leaves empty space. -->
      <PlannerBatchStrips v-if="batchPosts.length" class="mt-3" :posts="batchPosts" />
    </div>
    <div v-else-if="ready && plan && !configuringMore" class="border-t border-default p-4">
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
              {{ counted('monthly.postsAwaitingApproval', plan.completed) }}
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
        </div>
      </div>
      <div v-if="batchPosts.length" class="mt-3">
        <PlannerBatchStrips :posts="batchPosts" />
      </div>
      <div
        v-if="extendable"
        class="mt-3 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UIcon name="i-lucide-sparkles" class="size-4" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-highlighted">{{ t('monthly.generateMoreTitle') }}</p>
          </div>
        </div>
        <div class="flex w-full flex-col gap-2 lg:flex-row lg:items-end xl:w-auto xl:shrink-0">
          <div class="grid w-full grid-cols-2 gap-2 rounded-xl border border-primary/10 bg-default/70 p-2 sm:w-[28rem] lg:shrink-0">
            <UFormField :label="t('monthly.postSelectionCount', { selected: selectedQuantity, total: remainingPosts })" size="xs" class="min-w-0">
              <LiveInputNumber v-model="selectedQuantity" size="lg" :min="0" :max="remainingPosts" class="w-full" />
            </UFormField>
            <UFormField :label="t('monthly.videoSelectionCount', { selected: selectedVideoQuantity, total: remainingVideos })" size="xs" class="min-w-0">
              <LiveInputNumber
v-model="selectedVideoQuantity"
                size="lg"
                :min="0"
                :max="maxVideosThisBatch"
                class="w-full"
                :aria-label="t('video.quantity')"
              />
            </UFormField>
          </div>
          <UButton
            class="w-full justify-center whitespace-nowrap lg:mb-2 lg:w-80 lg:shrink-0"
            :loading="busy"
            :disabled="selectedQuantity + selectedVideoQuantity < 1"
            icon="i-lucide-plus"
            @click="configureMore"
          >
            {{ generateMoreLabel }}
          </UButton>
        </div>
      </div>
    </div>

    <div v-else class="space-y-4 border-t border-default p-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-highlighted">
          {{ extendable ? t('monthly.generateMoreTitle') : t('monthly.readyToPrepare') }}
        </h3>
        <UButton
          v-if="configuringMore"
          type="button"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :aria-label="t('common.cancel')"
          @click="configuringMore = false"
        />
      </div>
      <!-- Two equal tiles: what each one counts sits right above its stepper,
           so the pair reads the same on a phone and on a wide screen. -->
      <div class="grid grid-cols-2 gap-2 sm:gap-3">
        <div class="rounded-xl border border-default bg-elevated/40 p-3">
          <p class="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <UIcon name="i-lucide-image" class="size-3.5 text-primary" />{{ t('monthly.quantityLabel') }}
          </p>
          <LiveInputNumber id="planner-post-count" v-model="selectedQuantity" :min="0" :max="remainingPosts" class="w-full" />
        </div>
        <div class="rounded-xl border border-default bg-elevated/40 p-3">
          <p class="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <UIcon name="i-lucide-clapperboard" class="size-3.5 text-primary" />{{ t('video.include') }}
          </p>
          <LiveInputNumber
            v-model="selectedVideoQuantity"
            :min="0"
            :max="maxVideosThisBatch"
            class="w-full"
            :aria-label="t('video.quantity')"
          />
        </div>
      </div>
      <div
        v-if="originalPhotos.length && (selectedQuantity || selectedVideoQuantity)"
        ref="photoTile"
        class="scroll-mt-24 rounded-xl border border-default bg-elevated/40 p-3"
      >
        <!-- One tab per kind the request makes, each saying what its photos
             become and how many are chosen. A kind with none asked is hidden. -->
        <div class="grid gap-1 rounded-md bg-elevated p-1" :class="selectedQuantity && selectedVideoQuantity ? 'grid-cols-2' : 'grid-cols-1'" role="tablist">
          <UButton
            v-for="tab in ([
              { kind: 'post' as const, show: selectedQuantity > 0, icon: 'i-lucide-image', label: t('monthly.photosForPostsTab'), short: t('monthly.photosForPostsShort'), count: selectedPhotoIds.length, of: selectedQuantity },
              { kind: 'video' as const, show: selectedVideoQuantity > 0, icon: 'i-lucide-clapperboard', label: t('monthly.photosForVideosTab'), short: t('monthly.photosForVideosShort'), count: selectedVideoPhotoIds.length, of: selectedVideoQuantity },
            ]).filter((item) => item.show)"
            :key="tab.kind"
            block
            size="sm"
            role="tab"
            :aria-selected="pickFor === tab.kind"
            :icon="tab.icon"
            :color="pickFor === tab.kind ? 'primary' : 'neutral'"
            :variant="pickFor === tab.kind ? 'solid' : 'ghost'"
            class="min-w-0 justify-center"
            @click="pickFor = tab.kind"
          >
            <span class="truncate sm:hidden">{{ tab.short }}</span>
            <span class="hidden truncate sm:inline">{{ tab.label }}</span>
            <span class="shrink-0 tabular-nums opacity-80">{{ tab.count }}/{{ tab.of }}</span>
          </UButton>
        </div>
        <p v-if="photoMode === 'auto' && pickFor === 'post'" class="mt-2 text-xs text-muted">{{ t('monthly.aiPicksIfEmpty') }}</p>
        <!-- With videos, one video is filled at a time and this panel says
             which: its number and photographs, with arrows and dots to move
             between the videos. It takes the place of the posts tab's note,
             above the photographs. -->
        <div
          v-if="selectedVideoQuantity && pickFor === 'video'"
          class="mt-2 rounded-md border border-default bg-default p-2.5"
        >
          <div class="flex items-center gap-1">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-chevron-left"
              :aria-label="t('common.previous')"
              :disabled="activeVideo === 0"
              @click="activeVideo--"
            />
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-1.5 text-sm font-semibold text-highlighted">
                <UIcon name="i-lucide-clapperboard" class="size-4 shrink-0 text-primary" />
                {{ t('monthly.videoCardTitle', { number: activeVideo + 1 }) }}
                <span class="font-normal text-muted">/ {{ selectedVideoQuantity }}</span>
              </p>
              <p class="truncate text-xs" :class="videoGroups[activeVideo]?.length ? 'text-primary' : 'text-muted'">
                {{ videoGroups[activeVideo]?.length
                  ? t('monthly.videoPhotoCount', { count: videoGroups[activeVideo]!.length, max: maxVideoPhotos })
                  : t('monthly.videoSlotHint') }}
              </p>
            </div>
            <div v-if="selectedVideoQuantity > 1" class="hidden items-center gap-1 px-1 sm:flex">
              <UButton
                v-for="card in selectedVideoQuantity"
                :key="card"
                color="neutral"
                variant="link"
                size="xs"
                class="p-0.5"
                :aria-label="t('monthly.videoCardTitle', { number: card })"
                :aria-current="activeVideo === card - 1 ? 'step' : undefined"
                @click="activeVideo = card - 1"
              >
                <span
                  class="block h-1.5 rounded-full transition-all"
                  :class="[
                    activeVideo === card - 1 ? 'w-4' : 'w-1.5',
                    videoGroups[card - 1]?.length ? 'bg-primary' : 'bg-accented',
                  ]"
                />
              </UButton>
            </div>
            <UButton
              color="neutral"
              :variant="videoGroups[activeVideo]?.length && activeVideo < selectedVideoQuantity - 1 ? 'soft' : 'ghost'"
              size="sm"
              icon="i-lucide-chevron-right"
              :aria-label="t('common.next')"
              :disabled="activeVideo >= selectedVideoQuantity - 1"
              @click="activeVideo++"
            />
          </div>
          <div
            v-if="!videoGroups[activeVideo]?.length && !freeVideoPhotos.length"
            class="mt-2.5 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning"
          >
            {{ t('monthly.noFreeVideoPhotos') }}
          </div>
          <!-- The photographs of this video, in order: tap to see one large,
               × to take it out. -->
          <div v-if="videoGroups[activeVideo]?.length" class="mt-2.5 flex flex-wrap gap-2.5 pl-1 pt-1">
            <div v-for="(id, index) in videoGroups[activeVideo]" :key="id" class="relative">
              <UButton
                color="neutral"
                variant="ghost"
                class="relative size-14 overflow-hidden rounded-md p-0"
                :aria-label="t('monthly.previewPhoto', { name: photoById(id)?.name || '' })"
                @click="preview = { ids: [...videoGroups[activeVideo]!], index }"
              >
                <MediaImage :src="photoById(id)?.url || ''" alt="" fit="cover" width="56" height="56" class="size-full" />
                <span class="absolute bottom-1 left-1 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-inverted">{{ index + 1 }}</span>
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                size="xs"
                icon="i-lucide-x"
                class="absolute -right-1.5 -top-1.5 size-5 justify-center rounded-full bg-default p-0 shadow-sm"
                :ui="{ leadingIcon: 'size-3' }"
                :aria-label="t('monthly.removePhoto', { name: photoById(id)?.name || '' })"
                @click="togglePhoto(id, 'video')"
              />
            </div>
          </div>
        </div>
        <!-- One video at a time takes photographs; the first one is its main. -->
        <!-- p-1/-m-1: the ring of a chosen photograph is drawn outside it, and a
             scroll container clips anything outside its padding box. -->
        <div class="-m-1 mt-2 flex gap-2 overflow-x-auto p-1 pb-2">
          <UButton
            v-for="asset in originalPhotos"
            :key="asset.id"
            type="button"
            color="neutral"
            variant="ghost"
            class="relative size-16 shrink-0 overflow-hidden rounded-md p-0 transition sm:size-20"
            :class="[
              tileChosen(asset.id) ? 'ring-2 ring-primary ring-offset-2 ring-offset-default' : '',
              tileLocked(asset.id) ? 'opacity-40' : '',
            ]"
            :aria-pressed="tileChosen(asset.id)"
            :aria-label="asset.name"
            :disabled="tileLocked(asset.id)"
            @click="togglePhoto(asset.id, pickFor)"
          >
            <MediaImage :src="asset.url" :alt="asset.name" fit="cover" width="80" height="80" class="size-full" />
            <span
              v-if="tileBadge(asset.id)"
              class="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold shadow"
              :class="tileChosen(asset.id) ? 'bg-primary text-inverted' : 'bg-black/60 text-white'"
            >{{ tileBadge(asset.id) }}</span>
          </UButton>
        </div>
      </div>
      <!-- On a phone the button stays in reach at the bottom of the screen. -->
      <div class="sticky bottom-0 z-10 -mx-4 -mb-4 border-t border-default bg-default/95 px-4 py-3 backdrop-blur sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <UButton
          block
          size="lg"
          :loading="busy"
          :icon="nextStep.kind === 'ready' ? 'i-lucide-sparkles' : nextStep.kind === 'upload' ? 'i-lucide-upload' : 'i-lucide-arrow-right'"
          :color="nextStep.kind === 'ready' ? 'primary' : 'neutral'"
          :variant="nextStep.kind === 'ready' ? 'solid' : 'outline'"
          class="justify-center sm:ml-auto sm:flex sm:w-auto sm:px-8"
          @click="runNextStep"
        >
          {{ nextStepLabel }}
        </UButton>
      </div>
    </div>

    <UModal
      v-if="preview && previewPhoto"
      :open="!!preview"
      :title="previewPhoto.name"
      :description="preview.ids.length > 1 ? `${preview.index + 1} / ${preview.ids.length}` : undefined"
      :ui="{ content: 'sm:max-w-3xl' }"
      @update:open="(open: boolean) => { if (!open) preview = null }"
    >
      <template #body>
        <div
          class="relative flex h-[70vh] items-center justify-center"
          tabindex="-1"
          @keydown.left="movePreview(-1)"
          @keydown.right="movePreview(1)"
        >
          <MediaImage :src="previewPhoto.url" :alt="previewPhoto.name" fit="natural" :surface="false" class="size-full [&>img]:rounded-xl" />
          <template v-if="preview.ids.length > 1">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-chevron-left"
              class="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60 hover:text-white"
              :aria-label="t('common.previous')"
              @click="movePreview(-1)"
            />
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-chevron-right"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60 hover:text-white"
              :aria-label="t('common.next')"
              @click="movePreview(1)"
            />
          </template>
        </div>
      </template>
    </UModal>

    <LazyPlannerRequestModal
      v-if="requestOpen"
      v-model:open="requestOpen"
      :post-count="selectedQuantity"
      :video-count="selectedVideoQuantity"
      :busy="busy"
      :submit-label="requestAction === 'prepare' ? t('legacy.prepareMonth') : generateMoreLabel"
      @submit="confirmRequest"
    />

    <UModal
      v-if="resetOpen"
      v-model:open="resetOpen"
      :dismissible="false"
      :title="t('monthly.resetTitle')"
      :description="t('monthly.resetCannotUndo')"
    >
      <template #body>
        <!-- What starting over does, matching resetMonthlyPlan on the server. -->
        <ul class="space-y-3 text-sm">
          <li class="flex gap-3">
            <UIcon name="i-lucide-trash-2" class="mt-0.5 size-4 shrink-0 text-error" />
            <span>{{ t('monthly.resetDeletes') }}</span>
          </li>
          <li class="flex gap-3">
            <UIcon name="i-lucide-eraser" class="mt-0.5 size-4 shrink-0 text-error" />
            <span>{{ t('monthly.resetClears') }}</span>
          </li>
          <li class="flex gap-3">
            <UIcon name="i-lucide-coins" class="mt-0.5 size-4 shrink-0 text-warning" />
            <span>{{ t('monthly.resetNoRefund') }}</span>
          </li>
          <li class="flex gap-3">
            <UIcon name="i-lucide-shield-check" class="mt-0.5 size-4 shrink-0 text-success" />
            <span>{{ t('monthly.resetKeeps') }}</span>
          </li>
        </ul>
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
      v-if="researchOpen"
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
                :loading="exporting === 'research'"
                @click="downloadReport('research')"
              >
                {{ t('monthly.exportResearchPdf') }}
              </UButton>
              <UButton
                v-if="plan?.strategy"
                color="primary"
                variant="solid"
                icon="i-lucide-file-down"
                :loading="exporting === 'strategy'"
                @click="downloadReport('strategy')"
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

          <LazyMonthlyStrategyView
            v-if="plan?.strategy"
            :strategy="plan.strategy"
            :assets="originalPhotos"
          />
          <LazyResearchEvidence v-if="plan?.research" :research="plan.research" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
