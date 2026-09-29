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
  defineProps<{ endpoint?: string, compact?: boolean, contactKnown?: boolean }>(),
  { endpoint: '/api/package-requests', compact: false, contactKnown: false },
)
const emit = defineEmits<{ sent: [] }>()
const { t } = useI18n()
const { onFormError, watchError } = useFormFeedback()

const form = reactive({
  contactName: '',
  contactEmail: '',
  phone: '',
  postsRequested: 20,
  message: '',
})
// Optional, but validated once it is filled in: a half-typed number is worse
// than none when the team calls back.
const phoneField = z
  .string()
  .trim()
  .max(40)
  .refine(value => !value || value.length >= 4, t('request.phoneInvalid'))
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
      }),
)

const sending = ref(false)
const sent = ref(false)
const error = ref('')
watchError(error)

async function submit() {
  sending.value = true
  error.value = ''
  const message = form.message.trim()
  const phone = form.phone.trim()
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
              ...(phone ? { phone } : {}),
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
      <UInputNumber v-model="form.postsRequested" :min="1" :max="1000" class="w-full" />
    </UFormField>
    <UFormField v-if="contactKnown" name="message" :label="t('request.message')">
      <UTextarea v-model="form.message" :rows="2" :maxlength="2000" class="w-full" />
    </UFormField>
    <div v-else :class="compact ? 'space-y-4' : 'grid gap-4 sm:grid-cols-2'">
      <UFormField name="contactName" :label="t('request.name')">
        <UInput v-model="form.contactName" :maxlength="120" class="w-full" />
      </UFormField>
      <UFormField name="contactEmail" :label="t('request.email')">
        <UInput v-model="form.contactEmail" type="email" :maxlength="320" class="w-full" />
      </UFormField>
      <UFormField name="phone" :label="t('request.phone')">
        <UInput v-model="form.phone" type="tel" :maxlength="40" class="w-full" />
      </UFormField>
    </div>
    <UButton type="submit" :loading="sending" :label="t('request.submit')" block />
  </UForm>
</template>
