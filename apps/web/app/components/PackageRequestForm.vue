<script setup lang="ts">
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
  defineProps<{ endpoint?: string, compact?: boolean, contactKnown?: boolean, submitLabelKey?: string }>(),
  { endpoint: '/api/package-requests', compact: false, contactKnown: false, submitLabelKey: '' },
)
const emit = defineEmits<{ sent: [] }>()
const { t } = useI18n()
const { onFormError, watchError } = useFormFeedback()

const form = reactive({
  contactName: '',
  contactEmail: '',
  phone: '',
  businessName: '',
  industry: '',
  platform: 'both' as 'instagram' | 'facebook' | 'both',
  postsRequested: 20,
  message: '',
})
// Suggested amounts come from a platform setting rather than this component,
// because every organization still agrees its own volume.
const { data: options } = await useFetch<{ postOptions: number[] }>('/api/package-requests', {
  key: 'package-request-options',
  server: false,
  immediate: !props.contactKnown,
  default: () => ({ postOptions: [] }),
})
const postOptions = computed(() => options.value?.postOptions || [])
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
const schema = computed(() =>
  props.contactKnown
    ? z.object({
        postsRequested: z.number().int().min(1, t('request.postsRequired')).max(1000),
        message: z.string().trim().max(2000),
      })
    : z.object({
        postsRequested: z.number().int().min(1, t('request.postsRequired')).max(1000),
        contactName: z.string().trim().min(2, t('request.nameRequired')).max(120),
        contactEmail: z.email(t('request.emailInvalid')).max(320),
        phone: phoneField,
        businessName: z.string().trim().min(2, t('request.businessRequired')).max(120),
        industry: z.string().trim().min(2, t('request.industryRequired')).max(100),
        platform: z.enum(['instagram', 'facebook', 'both']),
      }),
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

async function submit() {
  sending.value = true
  error.value = ''
  const message = form.message.trim()
  try {
    await $fetch(props.endpoint, {
      method: 'POST',
      body: {
        postsRequested: form.postsRequested,
        ...(props.contactKnown
          ? (message ? { message } : {})
          : {
              contactName: form.contactName.trim(),
              contactEmail: form.contactEmail.trim(),
              businessName: form.businessName.trim(),
              industry: form.industry.trim(),
              platform: form.platform,
              phone: phoneNumber.value,
              ...(message ? { message } : {}),
            }),
      },
    })
    sent.value = true
    emit('sent')
  }
  catch (problem) {
    error.value = (problem as { data?: { message?: string } }).data?.message || t('request.failed')
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <div v-if="sent" class="flex items-center gap-3" data-testid="package-request-sent">
    <UIcon name="i-lucide-check-circle-2" class="size-5 shrink-0 text-primary" />
    <p class="text-sm">{{ t('request.sentDescription') }}</p>
  </div>
  <UForm
    v-else
    :schema="schema"
    :state="form"
    class="space-y-4"
    data-testid="package-request-form"
    @submit="submit"
    @error="onFormError"
  >
    <UFormField name="postsRequested" :label="t('request.posts')">
      <div class="space-y-2">
        <div v-if="!contactKnown && postOptions.length" class="flex flex-wrap gap-2">
          <UButton
            v-for="amount in postOptions"
            :key="amount"
            size="sm"
            :color="form.postsRequested === amount ? 'primary' : 'neutral'"
            :variant="form.postsRequested === amount ? 'solid' : 'outline'"
            :aria-pressed="form.postsRequested === amount"
            :label="String(amount)"
            @click="form.postsRequested = amount"
          />
        </div>
        <UInputNumber v-model="form.postsRequested" :min="1" :max="1000" class="w-full" />
      </div>
    </UFormField>
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
      <UFormField name="contactName" :label="t('request.name')">
        <UInput
          v-model="form.contactName"
          :placeholder="t('request.namePlaceholder')"
          :maxlength="120"
          class="w-full"
        />
      </UFormField>
      <UFormField name="contactEmail" :label="t('request.email')">
        <UInput
          v-model="form.contactEmail"
          type="email"
          :placeholder="t('request.emailPlaceholder')"
          :maxlength="320"
          class="w-full"
        />
      </UFormField>
      <UFormField name="phone" :label="t('request.phone')">
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
      <UFormField name="businessName" :label="t('request.businessName')">
        <UInput
          v-model="form.businessName"
          :placeholder="t('request.businessPlaceholder')"
          :maxlength="120"
          class="w-full"
        />
      </UFormField>
      <UFormField name="industry" :label="t('request.industry')">
        <UInput
          v-model="form.industry"
          :placeholder="t('request.industryPlaceholder')"
          :maxlength="100"
          class="w-full"
        />
      </UFormField>
      <UFormField name="platform" :label="t('request.platform')">
        <USelect v-model="form.platform" :items="platformOptions" class="w-full" />
      </UFormField>
      <UFormField name="message" :label="t('request.message')" :class="compact ? '' : 'sm:col-span-2'">
        <UTextarea
          v-model="form.message"
          :placeholder="t('request.messagePlaceholder')"
          :rows="2"
          :maxlength="2000"
          class="w-full"
        />
      </UFormField>
    </div>
    <UButton type="submit" :loading="sending" :label="t(props.submitLabelKey || 'request.submit')" block />
  </UForm>
</template>
