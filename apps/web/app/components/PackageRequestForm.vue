<script setup lang="ts">
import { DEFAULT_PACKAGE_REQUEST } from '~~/shared/utils/package-defaults'
import { z } from 'zod'

/**
 * Asking for a package rather than buying one. Payment is taken in cash, so the
 * customer says how much they need and the team answers with an offer.
 *
 * The public form asks for the volume and how to reach them. Inside the app the
 * contact and the organization both come from the session, so it asks for the
 * volume and an optional note only.
 */
const props = withDefaults(
  defineProps<{
    endpoint?: string
    compact?: boolean
    contactKnown?: boolean
    submitLabelKey?: string
    // A first-contact form: the fewest fields that let the team call back.
    // Industry, channel and a free-text note are dropped, because each extra
    // field on a landing page costs leads and the team can ask on the call.
    lean?: boolean
    // A public lead form can return to its ready state after acknowledging a
    // request, while in-app forms may keep their confirmation visible.
    resetAfterSentMs?: number
    currency?: 'EUR' | 'CHF'
    exchangeRate?: number
  }>(),
  {
    endpoint: '/api/package-requests',
    compact: false,
    contactKnown: false,
    submitLabelKey: '',
    lean: false,
    resetAfterSentMs: 0,
    currency: 'CHF',
    exchangeRate: 1,
  },
)
const emit = defineEmits<{ sent: [] }>()
// The page around the form may show the chosen volume and its price, so the
// number is shared rather than duplicated.
const postsModel = defineModel<number>('posts', { default: 0 })
const videosModel = defineModel<number>('videos', { default: 0 })
const { t } = useI18n()
const { onFormError, watchError, showSuccess } = useFormFeedback()

const form = reactive({
  contactName: '',
  contactEmail: '',
  phone: '',
  businessName: '',
  industry: '',
  platform: 'both' as 'instagram' | 'facebook' | 'both',
  postsRequested: DEFAULT_PACKAGE_REQUEST.posts,
  videosRequested: DEFAULT_PACKAGE_REQUEST.videos,
  message: '',
})
if (postsModel.value > 0) form.postsRequested = postsModel.value
if (videosModel.value > 0) form.videosRequested = videosModel.value
watch(() => form.postsRequested, (value) => { postsModel.value = value })
watch(() => form.videosRequested, (value) => { videosModel.value = value })
watch(postsModel, (value) => {
  if (value > 0 && value !== form.postsRequested) form.postsRequested = value
})
watch(videosModel, (value) => {
  if (value >= 0 && value !== form.videosRequested) form.videosRequested = value
})
// Suggested amounts come from a platform setting rather than this component,
// because every organization still agrees its own volume.
const { data: options } = await useFetch<{
  postOptions: number[]
  postPriceCents: number
  videoPriceCents: number
  currency: 'CHF' | 'EUR'
}>(
  '/api/package-requests',
  {
    // LandingPackageRequest has its own ready-state default. A separate key
    // avoids Nuxt merging the two incompatible useFetch option sets.
    key: 'package-request-form-options',
    server: false,
  },
)
const postOptions = computed(() => options.value?.postOptions || [])
// What a post costs today. Showing it before the request is sent means nobody
// asks for a volume without knowing what it implies; the team still confirms
// the final figure in the offer.
const postPrice = computed(() => (options.value?.postPriceCents || 0) / 100)
const videoPrice = computed(() => (options.value?.videoPriceCents || 0) / 100)
const exchangeRate = computed(() => props.contactKnown ? (props.exchangeRate || 1) : 1)
const displayPostPrice = computed(() => postPrice.value * exchangeRate.value)
const displayVideoPrice = computed(() => videoPrice.value * exchangeRate.value)
// A mixed request is one package: its estimate must include every requested
// deliverable, not only the post volume.
const estimatedTotal = computed(() =>
  displayPostPrice.value * form.postsRequested
  + displayVideoPrice.value * form.videosRequested,
)
const volumeItems = computed(() => [
  { name: 'postsRequested' as const, label: t('request.posts'), icon: 'i-lucide-image', price: displayPostPrice.value },
  { name: 'videosRequested' as const, label: t('request.videos'), icon: 'i-lucide-clapperboard', price: displayVideoPrice.value },
])
const money = (value: number) =>
  new Intl.NumberFormat('sq-XK', {
    style: 'currency',
    // Signed-in clients see their own currency; public visitors see the rates
    // in the currency they are stored in.
    currency: props.contactKnown ? props.currency : (options.value?.currency || 'CHF'),
  }).format(value)
const platformOptions = computed(() => [
  { label: t('request.platformInstagram'), value: 'instagram' as const },
  { label: t('request.platformFacebook'), value: 'facebook' as const },
  { label: t('request.platformBoth'), value: 'both' as const },
])
// The team answers a cash agreement by calling, so a reachable number is part
// of the request rather than an extra.
const phoneField = z
  .string()
  .trim()
  .max(24)
  .refine(value => value.replace(/\D/g, '').length >= 6, t('request.phoneRequired'))
// Videos alone are a package too; only an empty request is refused.
const asksForSomething = (value: { postsRequested: number; videosRequested: number }) =>
  value.postsRequested > 0 || value.videosRequested > 0
const postsOrVideos = { message: t('request.postsRequired'), path: ['postsRequested'] }
const schema = computed(() =>
  props.contactKnown
    ? z.object({
        postsRequested: z.number().int().min(0).max(1000),
        videosRequested: z.number().int().min(0).max(1000),
        message: z.string().trim().max(2000),
      }).refine(asksForSomething, postsOrVideos)
    : z.object({
        postsRequested: z.number().int().min(0).max(1000),
        videosRequested: z.number().int().min(0).max(1000),
        contactName: z.string().trim().min(2, t('request.nameRequired')).max(120),
        contactEmail: z.email(t('request.emailInvalid')).max(320),
        phone: phoneField,
        businessName: z.string().trim().min(2, t('request.businessRequired')).max(120),
        ...(props.lean
          ? {}
          : {
              industry: z.string().trim().min(2, t('request.industryRequired')).max(100),
              platform: z.enum(['instagram', 'facebook', 'both']),
            }),
      }).refine(asksForSomething, postsOrVideos),
)

// The plus belongs to the field rather than to what is typed, so the country
// code cannot be deleted by accident and no letter ever reaches the value.
watch(
  () => form.phone,
  (value) => {
    const digits = value.replace(/[^\d ]/g, '')
    if (digits !== value) form.phone = digits
  },
)
const phoneNumber = computed(() => {
  const digits = form.phone.replace(/\s+/g, ' ').trim()
  return digits ? `+${digits}` : ''
})

const sending = ref(false)
const sent = ref(false)
const error = ref('')
watchError(error)
let resetTimer: ReturnType<typeof setTimeout> | undefined

function resetAfterSuccess() {
  sent.value = false
  error.value = ''
  form.contactName = ''
  form.contactEmail = ''
  form.phone = ''
  form.businessName = ''
  form.industry = ''
  form.platform = 'both'
  form.message = ''
}

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer)
})

async function submit() {
  sending.value = true
  error.value = ''
  const message = form.message.trim()
  try {
    await $fetch(props.endpoint, {
      method: 'POST',
      body: {
        postsRequested: form.postsRequested,
        videosRequested: form.videosRequested,
        ...(props.contactKnown
          ? (message ? { message } : {})
          : {
              contactName: form.contactName.trim(),
              contactEmail: form.contactEmail.trim(),
              businessName: form.businessName.trim(),
              // A lean form never asked for these, and an empty string is not
              // the same as an absent field: the schema would reject it.
              ...(props.lean ? {} : { industry: form.industry.trim(), platform: form.platform }),
              phone: phoneNumber.value,
              ...(message ? { message } : {}),
            }),
      },
    })
    sent.value = true
    showSuccess(t('request.sentDescription'))
    emit('sent')
    if (props.resetAfterSentMs > 0) {
      if (resetTimer) clearTimeout(resetTimer)
      resetTimer = setTimeout(resetAfterSuccess, props.resetAfterSentMs)
    }
  }
  catch (problem) {
    error.value = t((problem as { data?: { message?: string } }).data?.message || 'request.failed')
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <Transition name="package-request" mode="out-in">
    <div v-if="sent" key="sent" class="flex items-center gap-3" data-testid="package-request-sent">
      <UIcon name="i-lucide-check-circle-2" class="size-5 shrink-0 text-primary" />
      <p class="text-sm">{{ t('request.sentDescription') }}</p>
    </div>
    <UForm
      v-else
      key="form"
      :schema="schema"
      :state="form"
      class="space-y-4"
      data-testid="package-request-form"
      @submit="submit"
      @error="onFormError"
    >
    <div class="divide-y divide-default rounded-lg border border-default">
      <UFormField
        v-for="item in volumeItems"
        :key="item.name"
        :name="item.name"
        class="p-3.5"
      >
        <div class="flex items-center gap-3">
          <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <UIcon :name="item.icon" class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-highlighted">{{ item.label }}</p>
            <p v-if="item.price > 0" class="text-xs text-muted tabular-nums">{{ money(item.price) }}</p>
          </div>
          <LiveInputNumber
            v-model="form[item.name]"
            :min="0"
            :max="1000"
            :aria-label="item.label"
            variant="soft"
            class="w-32 shrink-0"
            :ui="{ base: 'text-base font-semibold tabular-nums' }"
          />
        </div>
        <div
          v-if="item.name === 'postsRequested' && !contactKnown && !lean && postOptions.length"
          class="mt-3 flex flex-wrap gap-2"
        >
          <UButton
            v-for="amount in postOptions"
            :key="amount"
            size="sm"
            :color="form.postsRequested === amount ? 'primary' : 'neutral'"
            :variant="form.postsRequested === amount ? 'solid' : 'outline'"
            :aria-pressed="form.postsRequested === amount"
            :label="String(amount)"
            class="rounded-full"
            @click="form.postsRequested = amount"
          />
        </div>
      </UFormField>
    </div>
    <UFormField v-if="contactKnown" name="message" :label="t('request.message')">
      <UTextarea
        v-model="form.message"
        :placeholder="t('request.messagePlaceholder')"
        :rows="2"
        :maxlength="2000"
        class="w-full"
      />
    </UFormField>
    <div v-else :class="compact ? 'space-y-4' : 'grid gap-4 sm:grid-cols-2'">
      <UFormField name="contactName" :label="t('request.name')" required>
        <UInput
          v-model="form.contactName"
          :placeholder="t('request.namePlaceholder')"
          :maxlength="120"
          class="w-full"
        />
      </UFormField>
      <UFormField name="contactEmail" :label="t('request.email')" required>
        <UInput
          v-model="form.contactEmail"
          type="email"
          :placeholder="t('request.emailPlaceholder')"
          :maxlength="320"
          class="w-full"
        />
      </UFormField>
      <UFormField name="phone" :label="t('request.phone')" required>
        <UInput
          v-model="form.phone"
          type="tel"
          inputmode="numeric"
          autocomplete="tel"
          :placeholder="t('request.phonePlaceholder')"
          :maxlength="24"
          class="w-full"
        >
          <template #leading>
            <span class="text-sm text-muted">+</span>
          </template>
        </UInput>
      </UFormField>
      <UFormField name="businessName" :label="t('request.businessName')" required>
        <UInput
          v-model="form.businessName"
          :placeholder="t('request.businessPlaceholder')"
          :maxlength="120"
          class="w-full"
        />
      </UFormField>
      <UFormField v-if="!lean" name="industry" :label="t('request.industry')" required>
        <UInput
          v-model="form.industry"
          :placeholder="t('request.industryPlaceholder')"
          :maxlength="100"
          class="w-full"
        />
      </UFormField>
      <UFormField v-if="!lean" name="platform" :label="t('request.platform')" required>
        <USelect v-model="form.platform" :items="platformOptions" class="w-full" />
      </UFormField>
      <UFormField v-if="!lean" name="message" :label="t('request.message')" :class="compact ? '' : 'sm:col-span-2'">
        <UTextarea
          v-model="form.message"
          :placeholder="t('request.messagePlaceholder')"
          :rows="2"
          :maxlength="2000"
          class="w-full"
        />
      </UFormField>
    </div>
    <div
      v-if="(displayPostPrice > 0 || displayVideoPrice > 0) && !lean"
      class="rounded-lg bg-primary/10 p-4 ring-1 ring-primary/20 ring-inset"
    >
      <p class="text-xs font-medium uppercase tracking-wide text-muted">{{ t('request.estimateLabel') }}</p>
      <p class="mt-1 text-3xl font-semibold tabular-nums text-highlighted">{{ money(estimatedTotal) }}</p>
      <div class="mt-3 space-y-1 border-t border-primary/20 pt-3 text-xs text-muted tabular-nums">
        <p v-for="item in volumeItems" :key="item.name" class="flex justify-between gap-2">
          <span>{{ form[item.name] }} × {{ money(item.price) }}</span>
          <span>{{ money(form[item.name] * item.price) }}</span>
        </p>
      </div>
    </div>
    <UButton
      type="submit"
      :loading="sending"
      :label="t(props.submitLabelKey || 'request.submit')"
      trailing-icon="i-lucide-send"
      size="lg"
      block
    />
    </UForm>
  </Transition>
</template>

