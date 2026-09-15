<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'
import { zonedToIso } from '~~/shared/utils/format'
const props = defineProps<{ id?: string }>()
const { data, base, commit, transition, notify, conflict, initLive, syncing } = useWorkspace()
const { t } = useI18n()
function validationMessage(check: { key: string; message: string }) {
  return check.key === 'ai_quality' && check.message === 'Versioni aktual kërkon rishikim të tekstit dhe dizajnit me AI.'
    ? t('validation.aiQualityReview')
    : check.message
}
const route = useRoute()
const { data: catalog } = await useFetch('/api/templates', { key: 'post-templates' })
const { data: capabilities } = await useFetch('/api/capabilities')
const { data: meta } = await useFetch('/api/meta/status', { key: 'meta-status' })
const chosenTemplate = (catalog.value || []).find((p) => p.id === route.query.template)
const existing = computed(() => data.value.posts.find((p) => p.id === props.id))
if (props.id && !existing.value)
  throw createError({ statusCode: 404, statusMessage: t('content.postNotFound') })
const {
  form,
  localError,
  clear: clearRecovery,
} = useDraft(
  `${base.value}:content:${props.id || (chosenTemplate ? `new:${chosenTemplate.id}` : 'new')}`,
  {
    title: existing.value?.title || chosenTemplate?.title || '',
    caption: existing.value?.caption || chosenTemplate?.caption || '',
    channel: existing.value?.channel || chosenTemplate?.channel || ('Instagram' as Post['channel']),
    format: existing.value?.format || ('static' as Post['format']),
    image: existing.value?.image || chosenTemplate?.image || '',
    pillar: existing.value?.pillar || chosenTemplate?.topic || 'Produkti',
  },
)
const savedId = ref(props.id)
const post = computed(() => data.value.posts.find((p) => p.id === savedId.value))
const baseline = ref(
  JSON.stringify(chosenTemplate && !props.id ? { ...form, title: '', caption: '' } : form),
)
const dirty = computed(() => JSON.stringify(form) !== baseline.value)
function creativeSaved(image: string) {
  form.image = image
  baseline.value = JSON.stringify(form)
}
const saving = ref(false)
const savedAt = ref('')
const error = ref('')
const checking = ref(false)
const confirmed = ref(false)
const publishOpen = ref(false)
const publishing = ref(false)
const validation = ref<{
  scope: 'content' | 'publication'
  passed: boolean
  checks: { key: string; passed: boolean; message: string }[]
  manualReview: string
} | null>(null)
const publication = ref<{
  status: string
  failureCode: string | null
  disposition: 'retryable' | 'blocked' | 'uncertain' | 'terminal'
  remediation: string
  attempt: number
  maxAttempts: number
  runAt: string
} | null>(null)
const reconciling = ref(false)
async function reconcilePublication() {
  if (!post.value || reconciling.value) return
  reconciling.value = true
  error.value = ''
  try {
    const result = await $fetch(`/api/posts/${post.value.id}/reconcile`, {
      method: 'POST',
      body: {},
      retry: 0,
    })
    if (result.resolved) {
      notify(t('content.metaConfirmed'))
      await initLive()
      await refreshPublication()
    } else {
      error.value =
        t('content.metaUncertain')
    }
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message || t('content.metaCheckError')
  } finally {
    reconciling.value = false
  }
}
async function checkPost(scope: 'content' | 'publication' = 'content'): Promise<boolean> {
  await save()
  if (dirty.value || !savedId.value || checking.value) return false
  checking.value = true
  error.value = ''
  confirmed.value = false
  try {
    const result = await $fetch(`/api/posts/${savedId.value}/validate`, {
      method: 'POST',
      body: { scope },
      retry: 0,
    })
    validation.value = result
    await initLive()
    return result.passed
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message || t('content.checkError')
    return false
  } finally {
    checking.value = false
  }
}
async function publishNow() {
  if (!post.value || publishing.value) return
  publishing.value = true
  error.value = ''
  try {
    if (!(await checkPost('publication'))) {
      error.value ||= t('content.metaNotConfirmed')
      return
    }
    await $fetch(`/api/posts/${post.value.id}/publish`, {
      method: 'POST',
      body: { confirmed: true, version: post.value.version },
      retry: 0,
    })
    publishOpen.value = false
    await initLive()
    notify(t('content.publishQueued'))
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message || t('content.publishError')
  } finally {
    publishing.value = false
  }
}
let publicationTimer: ReturnType<typeof setInterval> | undefined
async function refreshPublication() {
  if (
    !post.value ||
    dirty.value ||
    syncing.value ||
    checking.value ||
    post.value.publicationMode !== 'automatic' ||
    !['scheduled', 'failed'].includes(post.value.status)
  )
    return
  try {
    const result = await $fetch(`/api/posts/${post.value.id}/publication`)
    publication.value = result.job
    if (
      result.job &&
      ['published', 'failed', 'uncertain'].includes(result.job.status) &&
      post.value.status === 'scheduled'
    )
      await initLive()
  } catch {
    /* Keep the last confirmed status; the user can refresh. */
  }
}
onMounted(() => {
  publicationTimer = setInterval(refreshPublication, 10000)
  void refreshPublication()
})
onBeforeUnmount(() => clearInterval(publicationTimer))
const scheduleOpen = ref(false)
const schedule = ref('')
const scheduleError = ref('')
const scheduleBusy = ref(false)
const automatic = ref(false)
const canPublish = computed(
  () =>
    !!capabilities.value?.publishing &&
    meta.value?.connection?.status === 'connected' &&
    (form.channel === 'Facebook'
      ? meta.value.connection.canPublishFacebook
      : !!meta.value.connection.instagramId && meta.value.connection.canPublishInstagram),
)
watch(scheduleOpen, (open) => {
  if (open) {
    automatic.value = false
    scheduleError.value = ''
    error.value = ''
  }
})
const versionOpen = ref(false)
const leaving = ref(false)
let resolveLeave: ((allow: boolean) => void) | undefined
const editable = computed(() => !post.value || ['draft', 'review'].includes(post.value.status))
const workflowStep = computed(() =>
  post.value?.status === 'scheduled'
    ? 2
    : post.value && ['review', 'approved'].includes(post.value.status)
      ? 1
      : 0,
)
let timer: ReturnType<typeof setTimeout> | undefined
async function save(silent = false) {
  clearTimeout(timer)
  if (!editable.value || !dirty.value || saving.value || conflict.value) return
  error.value = ''
  if (form.title.trim().length < 3 || !form.caption.trim() || !form.image) {
    if (!silent) error.value = t('content.requiredFields')
    return
  }
  saving.value = true
  const snapshot = structuredClone(toRaw(form))
  const id = savedId.value || crypto.randomUUID()
  const ok = await commit((d) => {
    const p = d.posts.find((p) => p.id === id)
    if (p) {
      p.history.push({ version: p.version, caption: p.caption, at: new Date().toISOString() })
      Object.assign(p, snapshot)
      p.version++
      p.status = 'draft'
      p.policy = 'warn'
      p.policyReason =
        t('content.changedPolicyReason')
    } else
      d.posts.unshift({
        id,
        ...snapshot,
        status: 'draft',
        scheduledAt: null,
        version: 1,
        history: [],
        policy: 'warn',
        policyReason:
          t('content.draftPolicyReason'),
      })
  })
  saving.value = false
  if (ok) {
    savedId.value = id
    baseline.value = JSON.stringify(snapshot)
    if (!dirty.value) clearRecovery()
    savedAt.value = new Intl.DateTimeFormat('sq-AL', { hour: '2-digit', minute: '2-digit' }).format(
      new Date(),
    )
    if (!silent) notify()
    if (dirty.value) timer = setTimeout(() => save(true), 900)
    else if (!props.id) await navigateTo(`${base.value}/content/${id}`, { replace: true })
  }
}
watch(form, () => {
  confirmed.value = false
  validation.value = null
  clearTimeout(timer)
  timer = setTimeout(() => save(true), 900)
})
async function setStatus(next: Post['status']) {
  if (next === 'approved' && post.value?.status !== 'scheduled' && !confirmed.value) {
    error.value = t('content.confirmFacts')
    return
  }
  await save()
  if (dirty.value || !savedId.value) return
  if (next === 'approved' && post.value?.status !== 'scheduled') {
    if (!(await checkPost())) return
    confirmed.value = true
  }
  if (await transition(savedId.value, next))
    notify(next === 'approved' ? t('content.postApprovedToast') : t('content.statusUpdatedToast'))
}
async function schedulePost() {
  if (scheduleBusy.value) return
  scheduleError.value = ''
  const iso = zonedToIso(schedule.value, data.value.preferences.timezone)
  if (!iso || Date.parse(iso) <= Date.now()) {
    scheduleError.value = t('content.invalidSchedule')
    return
  }
  scheduleBusy.value = true
  try {
    if (automatic.value && !(await checkPost('publication'))) {
      scheduleError.value =
        error.value || t('content.automaticRequirements')
      return
    }
    if (
      savedId.value &&
      (await transition(savedId.value, 'scheduled', iso, automatic.value ? 'automatic' : 'manual'))
    ) {
      scheduleOpen.value = false
      notify(automatic.value ? t('content.automaticScheduled') : t('content.addedToCalendar'))
    }
  } finally {
    scheduleBusy.value = false
  }
}
onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  leaving.value = true
  return new Promise<boolean>((resolve) => {
    resolveLeave = resolve
  })
})
function finishLeave(allow: boolean) {
  const resolve = resolveLeave
  resolveLeave = undefined
  leaving.value = false
  resolve?.(allow)
}
function handleLeaveOpen(open: boolean) {
  if (!open && resolveLeave) finishLeave(false)
  else leaving.value = open
}
async function saveAndLeave() {
  await save()
  if (!dirty.value) finishLeave(true)
}
function discardAndLeave() {
  clearTimeout(timer)
  clearRecovery()
  finishLeave(true)
}
onBeforeUnmount(() => {
  clearTimeout(timer)
})
</script>
<template>
  <DashboardPage
    :title="props.id ? t('content.editPost') : t('content.createPost')"
    :description="t('content.editorDescription')"
  >
    <PostProvenance v-if="post?.aiProvenance" :post="post" :disabled="dirty || syncing" />
    <template #actions
      ><span role="status" class="small muted">{{
        saving
          ? t('content.saving')
          : dirty
            ? t('content.unsavedChanges')
            : savedAt
              ? t('content.savedAt', { time: savedAt })
              : post
                ? t('content.savedOnServer')
                : t('content.serverSaving')
      }}</span
      ><UButton :to="`${base}/content`" variant="outline" color="neutral" icon="i-lucide-arrow-left"
        >{{ t('nav.posts') }}</UButton
      ><UButton
        v-if="editable"
        variant="outline"
        :loading="saving"
        :disabled="!dirty"
        icon="i-lucide-save"
        @click="save(false)"
        >{{ t('content.saveDraft') }}</UButton
      ></template
    >
    <UStepper
      :model-value="workflowStep"
      :items="[
        { title: 'Shkruaj', value: 0, icon: 'i-lucide-pencil' },
        { title: 'Kontrollo', value: 1, icon: 'i-lucide-check-check' },
        { title: 'Zgjidh orarin', value: 2, icon: 'i-lucide-calendar-days' },
      ]"
      disabled
      size="sm"
      class="mb-8 max-w-2xl"
      :aria-label="t('content.editorSteps')"
    />
    <span class="sr-only" role="status"
      >{{ t('content.stepStatus', { step: workflowStep + 1, title: [t('content.write'), t('content.check'), t('content.chooseSchedule')][workflowStep] || '' }) }}</span
    >
    <div class="editor-layout">
      <div class="stack">
        <UAlert v-if="error" color="error" :title="error" />
        <UAlert v-if="localError" color="warning" variant="outline" :title="localError" />
        <UCard as="div" :ui="{ body: 'p-5 sm:p-6 flex flex-col gap-5' }" class="">
          <div class="actions" style="justify-content: space-between">
            <h2>{{ t('content.contentDetails') }}</h2>
            <StatusBadge v-if="post" :status="post.status" />
          </div>
          <UFormField
            :label="t('content.postName')"
            name="title"
            :description="t('content.postNameDescription')"
            class="field"
            ><UInput
              v-model="form.title"
              :disabled="!editable"
              maxlength="120"
              :placeholder="t('content.postNamePlaceholder')"
              class="w-full"
          /></UFormField>
          <div class="grid-2">
            <UFormField :label="t('content.channel')" name="channel" class="field"
              ><USelect
                v-model="form.channel"
                :disabled="!editable"
                :items="['Instagram', 'Facebook']" /></UFormField
            ><UFormField :label="t('content.postTopic')" name="pillar" class="field"
              ><USelect
                v-model="form.pillar"
                :disabled="!editable"
                :items="[t('strategy.intent.product'), t('strategy.intent.behind_the_scenes'), t('strategy.goal.meaningful_comments'), t('strategy.goal.profile_actions'), t('brand.offerType')]"
            /></UFormField>
          </div>
          <UFormField :label="t('content.postText')" name="caption" class="field"
            ><UTextarea
              v-model="form.caption"
              :disabled="!editable"
              :rows="8"
              :maxlength="2200"
              :placeholder="t('content.postTextPlaceholder')"
              class="w-full"
            /><small
              >{{ t('content.characterCount', { count: form.caption.length }) }}</small
            ></UFormField
          >
          <div class="actions">
            <CaptionAssistant
              :caption="form.caption"
              :channel="form.channel"
              :disabled="!editable"
              @apply="form.caption = $event"
            /><UButton
              v-if="post"
              variant="ghost"
              color="neutral"
              icon="i-lucide-history"
              @click="versionOpen = true"
              >{{ t('content.versionHistory', { version: post.version }) }}</UButton
            >
          </div>
          <USeparator class="divider" style="margin: 0" />
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3>{{ t('content.postPhoto') }}</h3>
            <CreativeEditor
              v-if="post?.aiProvenance"
              :post="post"
              :disabled="!editable || dirty || syncing"
              @saved="creativeSaved"
            />
            <PhotoUpload v-if="editable" @uploaded="form.image = $event" />
          </div>
          <div
            v-if="form.image"
            class="size-16 shrink-0 overflow-hidden rounded-lg border-2 border-primary"
          >
            <MediaImage
              :src="form.image"
              :alt="t('photo.choosePhoto')"
              class="size-full object-cover"
            />
          </div>
          <div class="asset-picker">
            <UButton
              v-for="asset in data.assets.filter((a) => a.rights)"
              :key="asset.id"
              variant="ghost"
              color="neutral"
              :disabled="!editable"
              :aria-label="t('content.choosePhoto', { name: asset.name })"
              :aria-pressed="form.image === asset.url"
              :class="{ selected: form.image === asset.url }"
              @click="form.image = asset.url"
            >
              <MediaImage :src="asset.url" :alt="asset.name" class="w-full aspect-square rounded" />
            </UButton>
          </div>
          <ULink :to="`${base}/gallery`" class="text-primary small"
            >{{ t('content.managePhotos') }}</ULink
          >
        </UCard>
        <UCard as="div" :ui="{ body: 'p-5 sm:p-6 flex flex-col gap-5' }" class="">
          <h2>{{ t('content.preApprovalCheck') }}</h2>
          <UButton
            v-if="post && post.status !== 'published'"
            variant="outline"
            color="neutral"
            icon="i-lucide-shield-check"
            :loading="checking"
            :disabled="dirty || syncing"
            @click="checkPost()"
            >{{ t('content.checkContent') }}</UButton
          >
          <ul v-if="validation" class="space-y-3" :aria-label="t('content.validationResult')">
            <li v-for="check in validation.checks" :key="check.key" class="flex gap-2 text-sm">
              <UIcon
                :name="check.passed ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                :class="check.passed ? 'text-success' : 'text-error'"
                class="size-4 shrink-0 mt-0.5"
              /><span>{{ check.passed ? t('content.okPrefix') : '' }}{{ validationMessage(check) }}</span>
            </li>
          </ul>
          <UCheckbox
            v-if="post?.status === 'review' || post?.status === 'failed'"
            v-model="confirmed"
            :label="t('coverage.checkedFacts')"
            :description="t('coverage.approvalVersion')"
          />
          <UAlert
            v-if="publication?.status === 'uncertain'"
            variant="outline"
            color="warning"
            :title="t('coverage.publicationWaiting')"
            :description="t('content.uncertainDescription')"
          />
          <UAlert
            v-else-if="publication?.disposition === 'retryable'"
            variant="outline"
            color="info"
            :title="t('coverage.publicationRetry')"
            :description="`${publication.remediation} ${t('content.retryAttempt', { attempt: publication.attempt, maxAttempts: publication.maxAttempts })}`"
          />
          <UAlert
            v-else-if="publication?.status === 'failed'"
            variant="outline"
            :color="publication.disposition === 'blocked' ? 'warning' : 'error'"
            :title="
              publication.disposition === 'blocked'
                ? t('coverage.publicationAction')
                : t('coverage.publicationFailed')
            "
            :description="publication.remediation"
          />
          <div v-if="publication?.status === 'uncertain'" class="actions">
            <UButton
              variant="outline"
              icon="i-lucide-refresh-cw"
              :loading="reconciling"
              @click="reconcilePublication"
              >{{ t('content.checkMetaResult') }}</UButton
            ><UButton :to="`${base}/social-posts`" color="neutral" variant="outline"
              >{{ t('content.checkConnection') }}</UButton
            >
          </div>
          <UAlert
            :color="
              post?.policy === 'block'
                ? 'error'
                : post?.policy === 'warn' || !post
                  ? 'warning'
                  : 'success'
            "
            :title="
              post?.policy === 'block'
                ? t('coverage.needsCorrection')
                : post?.policy === 'pass'
                  ? t('coverage.technicalPassed')
                  : t('coverage.manualReview')
            "
            :description="
              post?.policyReason || t('content.verifyDescription')
            "
          /><ULink :to="`${base}/brand`" class="text-primary small"
            >{{ t('content.businessFacts') }}</ULink
          >
          <div class="actions">
            <UButton
              v-if="!post || post.status === 'draft'"
              variant="outline"
              :disabled="!form.title || !form.caption"
              @click="setStatus('review')"
              >{{ t('content.submitApproval') }}</UButton
            ><template v-if="post?.status === 'review'"
              ><UButton
                variant="outline"
                :disabled="!confirmed || checking || syncing"
                :loading="checking"
                icon="i-lucide-check"
                @click="setStatus('approved')"
                >{{ t('content.approvePost') }}</UButton
              ><UButton color="neutral" variant="outline" @click="setStatus('draft')"
                >{{ t('content.returnDraft') }}</UButton
              ></template
            ><template v-if="post?.status === 'approved'"
              ><UButton variant="outline" icon="i-lucide-send" @click="publishOpen = true"
                >{{ t('content.publishNow') }}</UButton
              ><UButton variant="outline" icon="i-lucide-calendar-plus" @click="scheduleOpen = true"
                >{{ t('content.schedulePost') }}</UButton
              ><UButton color="neutral" variant="outline" @click="setStatus('draft')"
                >{{ t('content.reopenEditing') }}</UButton
              ></template
            ><template v-if="post?.status === 'failed'"
              ><UButton
                variant="outline"
                :disabled="!confirmed || checking || syncing"
                :loading="checking"
                icon="i-lucide-rotate-ccw"
                @click="setStatus('approved')"
                >{{ t('content.reviewApproveAgain') }}</UButton
              ><UButton color="neutral" variant="outline" @click="setStatus('draft')"
                >{{ t('content.returnForCorrection') }}</UButton
              ></template
            ><UButton
              v-if="post?.status === 'scheduled'"
              color="neutral"
              variant="outline"
              @click="setStatus('approved')"
                >{{ t('content.removeFromCalendar') }}</UButton
            >
          </div>
          <UAlert
            v-if="post?.status === 'scheduled'"
            color="neutral"
            variant="outline"
            :title="
              post.publicationMode === 'automatic'
                ? t('content.automaticPlanned')
                : t('content.calendarOnlySaved')
            "
            :description="
              post.publicationMode === 'automatic'
                ? t('content.automaticDescription')
                : t('content.calendarOnlyDescription')
            "
          />
          <p class="small muted">
            {{ t('content.approvalCalendarNote') }}
          </p>
        </UCard>
      </div>
      <aside class="stack lg:sticky lg:top-6">
        <div class="actions" style="justify-content: space-between">
          <h2>{{ t('content.howItLooks') }}</h2>
          <UBadge variant="subtle" size="sm" class="">{{ t('preview.preview') }}</UBadge>
        </div>
        <ChannelPreview
          :channel="form.channel"
          :name="data.brand.name"
          :image="form.image"
          :caption="form.caption"
        />
        <p class="small muted text-center">
          {{ t('content.previewNote') }}
        </p>
      </aside>
    </div>
    <UModal
      v-model:open="publishOpen"
      :title="t('content.publishTitle', { channel: form.channel })"
      :description="t('content.publishDescription', { business: data.brand.name })"
    >
      <template #body
        ><div class="space-y-5">
          <UAlert v-if="error" color="error" variant="outline" :title="error" />
          <UAlert
            v-if="!canPublish"
            color="neutral"
            variant="outline"
            :title="t('content.metaConnectionRequiredTitle')"
            :actions="[
              {
                label: t('content.viewConnections'),
                to: base + '/social-posts',
                variant: 'outline',
                color: 'neutral',
              },
            ]"
          />
          <ChannelPreview
            :channel="form.channel"
            :name="data.brand.name"
            :image="form.image"
            :caption="form.caption"
          /><UButton
            block
            variant="outline"
            :loading="publishing"
            :disabled="!canPublish"
            @click="publishNow"
            >{{ t('content.confirmPublishNow') }}</UButton
          ><UButton block color="neutral" variant="ghost" @click="publishOpen = false"
            >{{ t('common.cancel') }}</UButton
          >
        </div></template
      >
    </UModal>
    <UModal
      v-model:open="scheduleOpen"
      :title="t('content.addToCalendar')"
      :description="t('content.scheduleTimezone', { timezone: data.preferences.timezone })"
      ><template #body
        ><UForm :state="{ schedule, automatic }" class="stack" @submit="schedulePost">
          <UFormField :label="t('content.dateAndTime')" name="schedule" class="field"
            ><UInput v-model="schedule" class="w-full" type="datetime-local" required
          /></UFormField>
          <p v-if="scheduleError" role="alert" class="field-error">{{ scheduleError }}</p>
          <UCheckbox
            v-model="automatic"
            :disabled="!canPublish || scheduleBusy"
            :label="t('content.publishAutomatically')"
            :description="
              canPublish
                ? t('content.automaticEnabledDescription')
                : t('content.automaticDisabledDescription')
            "
          />
          <UAlert
            color="neutral"
            variant="outline"
            :title="automatic ? t('content.automaticPublication') : t('content.calendarOnly')"
            :description="
              automatic
                ? t('content.automaticAlertDescription')
                : t('content.calendarOnlyAlertDescription')
            "
          /><UButton variant="outline" type="submit" :loading="scheduleBusy"
            >{{ t('content.confirmSchedule') }}</UButton
          >
        </UForm></template
      ></UModal
    >
    <USlideover
      v-model:open="versionOpen"
      :title="t('content.versionHistoryTitle')"
      :description="t('content.versionHistoryDescription')"
      ><template #body
        ><div class="stack">
          <UCard
            v-for="version in post?.history.slice().reverse()"
            :key="version.version"
            as="div"
            :ui="{ body: 'p-5 sm:p-6' }"
            class=""
          >
            <h3>{{ t('content.version', { version: version.version }) }}</h3>
            <p class="small muted my-2">{{ version.at }}</p>
            <p style="white-space: pre-wrap">{{ version.caption }}</p>
          </UCard>
          <p v-if="!post?.history.length" class="muted">{{ t('content.firstVersion') }}</p>
        </div></template
      ></USlideover
    >
    <UModal
      :open="leaving"
      :title="t('content.unsavedTitle')"
      :description="t('content.unsavedDescription')"
      @update:open="handleLeaveOpen"
      ><template #body
        ><div class="actions">
          <UButton
            variant="outline"
            @click="saveAndLeave"
            >{{ t('content.saveContinue') }}</UButton
          ><UButton color="error" variant="outline" @click="discardAndLeave()"
            >{{ t('content.leaveWithoutSaving') }}</UButton
          ><UButton color="neutral" variant="ghost" @click="finishLeave(false)">{{ t('content.stayHere') }}</UButton>
        </div></template
      ></UModal
    >
  </DashboardPage>
</template>
