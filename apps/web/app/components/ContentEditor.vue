<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'
import { zonedToIso } from '~~/shared/utils/format'
const props = defineProps<{ id?: string }>()
const { data, base, commit, transition, notify, conflict, initLive, syncing } = useWorkspace()
const route = useRoute()
const { data: catalog } = await useFetch('/api/templates', { key: 'post-templates' })
const { data: capabilities } = await useFetch('/api/capabilities')
const { data: meta } = await useFetch('/api/meta/status', { key: 'meta-status' })
const chosenTemplate = (catalog.value || []).find((p) => p.id === route.query.template)
const existing = computed(() => data.value.posts.find((p) => p.id === props.id))
if (props.id && !existing.value)
  throw createError({ statusCode: 404, statusMessage: 'Postimi nuk u gjet' })
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
    image: existing.value?.image || chosenTemplate?.image || data.value.assets[0]?.url || '',
    pillar: existing.value?.pillar || chosenTemplate?.topic || 'Produkti',
  },
)
const savedId = ref(props.id)
const post = computed(() => data.value.posts.find((p) => p.id === savedId.value))
const baseline = ref(
  JSON.stringify(chosenTemplate && !props.id ? { ...form, title: '', caption: '' } : form),
)
const dirty = computed(() => JSON.stringify(form) !== baseline.value)
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
      notify('Meta e konfirmoi publikimin')
      await initLive()
      await refreshPublication()
    } else {
      error.value =
        'Nuk u gjet një rezultat i vetëm dhe i sigurt në Meta. Postimi nuk u ridërgua; kontrollo përsëri pas pak.'
    }
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message ||
      'Kontrolli me Meta nuk u përfundua.'
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
      (problem as { data?: { message?: string } }).data?.message ||
      'Kontrolli nuk u përfundua. Provo sërish.'
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
      error.value ||= 'Lidhja me Meta nuk u konfirmua. Miratimi i postimit mbetet i ruajtur.'
      return
    }
    await $fetch(`/api/posts/${post.value.id}/publish`, {
      method: 'POST',
      body: { confirmed: true, version: post.value.version },
      retry: 0,
    })
    publishOpen.value = false
    await initLive()
    notify('Postimi u vendos në radhën e publikimit')
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message || 'Publikimi nuk filloi.'
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
const leaveTarget = ref('')
const allowLeave = ref(false)
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
    if (!silent) error.value = 'Plotëso titullin (të paktën 3 shkronja), tekstin dhe fotografinë.'
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
        'Përmbajtja është ndryshuar. Kontrollo manualisht faktet dhe të drejtat para miratimit.'
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
          'Draft i shkruar nga përdoruesi. Verifiko faktet dhe të drejtat përpara miratimit.',
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
    error.value = 'Konfirmo që i ke kontrolluar faktet dhe fotografinë.'
    return
  }
  await save()
  if (dirty.value || !savedId.value) return
  if (next === 'approved' && post.value?.status !== 'scheduled') {
    if (!(await checkPost())) return
    confirmed.value = true
  }
  if (await transition(savedId.value, next))
    notify(next === 'approved' ? 'Postimi u miratua' : 'Gjendja e postimit u përditësua')
}
async function schedulePost() {
  if (scheduleBusy.value) return
  scheduleError.value = ''
  const iso = zonedToIso(schedule.value, data.value.preferences.timezone)
  if (!iso || Date.parse(iso) <= Date.now()) {
    scheduleError.value = 'Zgjidh një datë të ardhshme dhe një orar të vlefshëm, jo të dykuptimtë.'
    return
  }
  scheduleBusy.value = true
  try {
    if (automatic.value && !(await checkPost('publication'))) {
      scheduleError.value =
        error.value || 'Për publikim automatik, lidh llogarinë me Meta dhe kontrollo lejet.'
      return
    }
    if (
      savedId.value &&
      (await transition(savedId.value, 'scheduled', iso, automatic.value ? 'automatic' : 'manual'))
    ) {
      scheduleOpen.value = false
      notify(automatic.value ? 'U planifikua publikimi automatik' : 'U shtua në kalendar')
    }
  } finally {
    scheduleBusy.value = false
  }
}
onBeforeRouteLeave((to) => {
  if (dirty.value && !allowLeave.value) {
    leaveTarget.value = to.fullPath
    leaving.value = true
    return false
  }
})
function discardAndLeave() {
  clearTimeout(timer)
  clearRecovery()
  allowLeave.value = true
  leaving.value = false
  navigateTo(leaveTarget.value)
}
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  clearTimeout(timer)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>
<template>
  <DashboardPage
    :title="props.id ? 'Redakto postimin' : 'Krijo postim'"
    description="Zgjidh fotografinë dhe shkruaj mesazhin. Ne ta ruajmë punën gjatë shkrimit."
  >
    <template #actions
      ><span role="status" class="small muted">{{
        saving
          ? 'Duke ruajtur…'
          : dirty
            ? 'Ndryshime të paruajtura'
            : savedAt
              ? `Ruajtur në server · ${savedAt}`
              : post
                ? 'Ruajtur në server'
                : 'Ruajtje në server'
      }}</span
      ><UButton :to="`${base}/content`" variant="outline" color="neutral" icon="i-lucide-arrow-left"
        >Postimet</UButton
      ><UButton
        v-if="editable"
        variant="outline"
        :loading="saving"
        :disabled="!dirty"
        icon="i-lucide-save"
        @click="save(false)"
        >Ruaj draftin</UButton
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
      aria-label="Hapat e përgatitjes së postimit"
    />
    <span class="sr-only" role="status"
      >Hapi {{ workflowStep + 1 }} nga 3:
      {{ ['Shkruaj', 'Kontrollo', 'Zgjidh orarin'][workflowStep] }}</span
    >
    <div class="editor-layout">
      <div class="stack">
        <UAlert v-if="error" color="error" :title="error" />
        <UAlert v-if="localError" color="warning" variant="outline" :title="localError" />
        <UCard as="div" :ui="{ body: 'p-5 sm:p-6 flex flex-col gap-5' }" class="">
          <div class="actions" style="justify-content: space-between">
            <h2>Detajet e përmbajtjes</h2>
            <StatusBadge v-if="post" :status="post.status" />
          </div>
          <UFormField
            label="Emri i postimit"
            name="title"
            description="Vetëm për organizimin tënd. Nuk shfaqet në rrjetin social."
            class="field"
            ><UInput
              v-model="form.title"
              :disabled="!editable"
              maxlength="120"
              placeholder="P.sh. Kafeja e mëngjesit"
              class="w-full"
          /></UFormField>
          <div class="grid-2">
            <UFormField label="Kanali" name="channel" class="field"
              ><USelect
                v-model="form.channel"
                :disabled="!editable"
                :items="['Instagram', 'Facebook']" /></UFormField
            ><UFormField label="Tema e postimit" name="pillar" class="field"
              ><USelect
                v-model="form.pillar"
                :disabled="!editable"
                :items="['Produkti', 'Atmosfera', 'Komuniteti', 'Stili i jetesës', 'Oferta']"
            /></UFormField>
          </div>
          <UFormField label="Teksti i postimit" name="caption" class="field"
            ><UTextarea
              v-model="form.caption"
              :disabled="!editable"
              :rows="8"
              :maxlength="2200"
              placeholder="Çfarë dëshiron t’i thuash audiencës?"
              class="w-full"
            /><small
              >{{ form.caption.length }} / 2 200 karaktere · Shfaqet si tekst i thjeshtë</small
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
              >Historiku · v{{ post.version }}</UButton
            >
          </div>
          <USeparator class="divider" style="margin: 0" />
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3>Fotografia e postimit</h3>
            <PhotoUpload v-if="editable" @uploaded="form.image = $event" />
          </div>
          <div class="asset-picker">
            <UButton
              v-for="asset in data.assets.filter((a) => a.rights)"
              :key="asset.id"
              variant="ghost"
              color="neutral"
              :disabled="!editable"
              :aria-label="`Zgjidh ${asset.name}`"
              :aria-pressed="form.image === asset.url"
              :class="{ selected: form.image === asset.url }"
              @click="form.image = asset.url"
            >
              <MediaImage :src="asset.url" :alt="asset.name" class="w-full aspect-square rounded" />
            </UButton>
          </div>
          <ULink :to="`${base}/gallery`" class="text-primary small"
            >Menaxho fotografitë dhe të drejtat →</ULink
          >
        </UCard>
        <UCard as="div" :ui="{ body: 'p-5 sm:p-6 flex flex-col gap-5' }" class="">
          <h2>Kontrolli para miratimit</h2>
          <UButton
            v-if="post && post.status !== 'published'"
            variant="outline"
            color="neutral"
            icon="i-lucide-shield-check"
            :loading="checking"
            :disabled="dirty || syncing"
            @click="checkPost()"
            >Kontrollo përmbajtjen</UButton
          >
          <ul v-if="validation" class="space-y-3" aria-label="Rezultati i kontrolleve">
            <li v-for="check in validation.checks" :key="check.key" class="flex gap-2 text-sm">
              <UIcon
                :name="check.passed ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                :class="check.passed ? 'text-success' : 'text-error'"
                class="size-4 shrink-0 mt-0.5"
              /><span>{{ check.passed ? 'Në rregull: ' : '' }}{{ check.message }}</span>
            </li>
          </ul>
          <UCheckbox
            v-if="post?.status === 'review' || post?.status === 'failed'"
            v-model="confirmed"
            label="I kontrollova faktet, çmimet, datat dhe të drejtat e fotografisë."
            description="Miratimi im vlen për këtë version të postimit."
          />
          <UAlert
            v-if="publication?.status === 'uncertain'"
            variant="outline"
            color="warning"
            title="Publikimi pret verifikim"
            description="Meta nuk dha konfirmim të plotë. Kontrollo postimin në profil; ridërgimi është bllokuar për të shmangur dyfishimin."
          />
          <UAlert
            v-else-if="publication?.disposition === 'retryable'"
            variant="outline"
            color="info"
            title="Publikimi do të provohet sërish"
            :description="`${publication.remediation} Tentimi ${publication.attempt} nga ${publication.maxAttempts}.`"
          />
          <UAlert
            v-else-if="publication?.status === 'failed'"
            variant="outline"
            :color="publication.disposition === 'blocked' ? 'warning' : 'error'"
            :title="
              publication.disposition === 'blocked'
                ? 'Publikimi kërkon veprim'
                : 'Publikimi nuk u përfundua'
            "
            :description="publication.remediation"
          />
          <div v-if="publication?.status === 'uncertain'" class="actions">
            <UButton
              variant="outline"
              icon="i-lucide-refresh-cw"
              :loading="reconciling"
              @click="reconcilePublication"
              >Kontrollo rezultatin në Meta</UButton
            ><UButton :to="`${base}/social-posts`" color="neutral" variant="outline"
              >Kontrollo lidhjen</UButton
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
                ? 'Kërkon korrigjim'
                : post?.policy === 'pass'
                  ? 'Kontrollet teknike kaluan'
                  : 'Kërkohet rishikim manual'
            "
            :description="
              post?.policyReason || 'Verifiko tekstin, burimet dhe të drejtat e fotografisë.'
            "
          /><ULink :to="`${base}/brand`" class="text-primary small"
            >Shiko faktet dhe burimet e biznesit →</ULink
          >
          <div class="actions">
            <UButton
              v-if="!post || post.status === 'draft'"
              variant="outline"
              :disabled="!form.title || !form.caption"
              @click="setStatus('review')"
              >Dërgo për miratim</UButton
            ><template v-if="post?.status === 'review'"
              ><UButton
                variant="outline"
                :disabled="!confirmed || checking || syncing"
                :loading="checking"
                icon="i-lucide-check"
                @click="setStatus('approved')"
                >Mirato postimin</UButton
              ><UButton color="neutral" variant="outline" @click="setStatus('draft')"
                >Kthe në draft</UButton
              ></template
        ><template v-if="post?.status === 'approved'"
              ><UButton variant="outline" icon="i-lucide-send" @click="publishOpen = true"
                >Publiko tani</UButton
              ><UButton variant="outline" icon="i-lucide-calendar-plus" @click="scheduleOpen = true"
                >Planifiko postimin</UButton
          ><UButton color="neutral" variant="outline" @click="setStatus('draft')"
            >Rihap për redaktim</UButton
          ></template
        ><template v-if="post?.status === 'failed'"
          ><UButton
            variant="outline"
            :disabled="!confirmed || checking || syncing"
            :loading="checking"
            icon="i-lucide-rotate-ccw"
            @click="setStatus('approved')"
            >Kontrollo dhe mirato sërish</UButton
          ><UButton color="neutral" variant="outline" @click="setStatus('draft')"
            >Kthe në draft për korrigjim</UButton
          ></template
        ><UButton
              v-if="post?.status === 'scheduled'"
              color="neutral"
              variant="outline"
              @click="setStatus('approved')"
              >Hiq nga kalendari</UButton
            >
          </div>
          <UAlert
            v-if="post?.status === 'scheduled'"
            color="neutral"
            variant="outline"
            :title="
              post.publicationMode === 'automatic'
                ? 'Publikim automatik i planifikuar'
                : 'Ruajtur vetëm në kalendar'
            "
            :description="
              post.publicationMode === 'automatic'
                ? 'Postimi do të dërgohet në orarin e zgjedhur nëse shërbimi dhe lidhja janë aktive.'
                : 'Orari yt u ruajt. Ky postim nuk dërgohet automatikisht në Facebook ose Instagram.'
            "
          />
          <p class="small muted">
            Mund ta miratosh dhe ta shtosh në kalendar pa lidhur Meta. Lidhja kërkohet vetëm për
            publikimin në rrjete sociale.
          </p>
        </UCard>
      </div>
      <aside class="stack lg:sticky lg:top-6">
        <div class="actions" style="justify-content: space-between">
          <h2>Si do të duket</h2>
          <UBadge variant="subtle" size="sm" class="">Parapamje</UBadge>
        </div>
        <ChannelPreview
          :channel="form.channel"
          :name="data.brand.name"
          :image="form.image"
          :caption="form.caption"
        />
        <p class="small muted text-center">
          Paraqitja përfundimtare mund të ndryshojë sipas kanalit.
        </p>
      </aside>
    </div>
    <UModal
      v-model:open="publishOpen"
      :title="'Publiko në ' + form.channel + '?'"
      :description="'Postimi do të dërgohet në llogarinë e lidhur të ' + data.brand.name + '.'"
    >
      <template #body
        ><div class="space-y-5">
          <UAlert v-if="error" color="error" variant="outline" :title="error" />
          <UAlert
            v-if="!canPublish"
            color="neutral"
            variant="outline"
            title="Publikimi kërkon lidhje aktive me Meta"
            :actions="[
              {
                label: 'Shiko lidhjet',
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
            >Konfirmoj publikimin tani</UButton
          ><UButton block color="neutral" variant="ghost" @click="publishOpen = false"
            >Anulo</UButton
          >
        </div></template
      >
    </UModal>
    <UModal
      v-model:open="scheduleOpen"
      title="Shto në kalendar"
      :description="`Orari interpretohet në ${data.preferences.timezone}.`"
      ><template #body
        ><UForm :state="{ schedule, automatic }" class="stack" @submit="schedulePost">
          <UFormField label="Data dhe ora" name="schedule" class="field"
            ><UInput v-model="schedule" class="w-full" type="datetime-local" required
          /></UFormField>
          <p v-if="scheduleError" role="alert" class="field-error">{{ scheduleError }}</p>
          <UCheckbox
            v-model="automatic"
            :disabled="!canPublish || scheduleBusy"
            label="Publiko automatikisht në këtë orar"
            :description="
              canPublish
                ? 'Nëse e aktivizon, postimi dërgohet në rrjetin e zgjedhur.'
                : 'Opsionale. Për këtë shërbim kërkohet lidhje aktive me Meta.'
            "
          />
          <UAlert
            color="neutral"
            variant="outline"
            :title="automatic ? 'Publikim automatik' : 'Vetëm në kalendar'"
            :description="
              automatic
                ? 'Postimi publikohet vetëm nëse shërbimi dhe lidhja me Meta janë aktive në atë orar.'
                : 'Orari ruhet për organizimin tënd. Nuk kërkohet lidhje me Meta dhe nuk kryhet publikim automatik.'
            "
          /><UButton variant="outline" type="submit" :loading="scheduleBusy"
            >Konfirmo orarin</UButton
          >
        </UForm></template
      ></UModal
    >
    <USlideover
      v-model:open="versionOpen"
      title="Historiku i versioneve"
      description="Versionet e mëparshme ruhen pa u mbishkruar."
      ><template #body
        ><div class="stack">
          <UCard
            v-for="version in post?.history.slice().reverse()"
            :key="version.version"
            as="div"
            :ui="{ body: 'p-5 sm:p-6' }"
            class=""
          >
            <h3>Versioni {{ version.version }}</h3>
            <p class="small muted my-2">{{ version.at }}</p>
            <p style="white-space: pre-wrap">{{ version.caption }}</p>
          </UCard>
          <p v-if="!post?.history.length" class="muted">Ky është versioni i parë.</p>
        </div></template
      ></USlideover
    >
    <UModal
      v-model:open="leaving"
      title="Ke ndryshime të paruajtura"
      description="Ruaji para se të largohesh ose vazhdo duke i hequr ndryshimet e fundit."
      ><template #body
        ><div class="actions">
          <UButton
            variant="outline"
            @click="
              async () => {
                await save()
                if (!dirty) {
                  leaving = false
                  allowLeave = true
                  navigateTo(leaveTarget)
                }
              }
            "
            >Ruaj dhe vazhdo</UButton
          ><UButton color="error" variant="outline" @click="discardAndLeave()"
            >Largohu pa ruajtur</UButton
          ><UButton color="neutral" variant="ghost" @click="leaving = false">Qëndro këtu</UButton>
        </div></template
      ></UModal
    >
  </DashboardPage>
</template>
