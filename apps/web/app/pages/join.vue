<script setup lang="ts">
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
const route = useRoute()
useSeoMeta({ title: () => `${t('join.title')} · Rrit`, robots: 'noindex' })

type Preview =
  | { valid: false }
  | {
      valid: true
      organizationName: string
      email: string
      profile: Record<string, string | undefined>
      expiresAt: string
    }

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
// The token travels in the body so it never lands in a server access log.
const { data: preview, pending } = await useFetch<Preview>('/api/invitations/preview', {
  method: 'POST',
  body: { token: token.value },
  immediate: Boolean(token.value),
  default: () => ({ valid: false }) as Preview,
})

const claiming = ref(true)
const failure = ref('')
const { showError } = useFormFeedback()

async function claim() {
  try {
    await $fetch('/api/invitations/accept', { method: 'POST', body: { token: token.value } })
    await navigateTo('/onboarding', { replace: true })
    return true
  } catch (error) {
    const problem = error as { statusCode?: number; data?: { message?: string } }
    if (problem.statusCode !== 401) {
      failure.value = t(problem.data?.message || 'join.acceptFailed')
      showError(failure.value)
    }
    return false
  }
}

// The link is opened twice: once to set a password, and again after the address
// is verified, when /auth/callback sends the client back here. Only the second
// visit carries a session, so acceptance is simply attempted — an
// unauthenticated attempt is the signal to ask for a password instead.
onMounted(async () => {
  if (!token.value) {
    claiming.value = false
    return
  }
  await claim()
  claiming.value = false
})
</script>
<template>
  <div class="space-y-6">
    <div v-if="pending || claiming" role="status" class="text-sm text-muted">
      {{ t('join.checking') }}
    </div>
    <UAlert
      v-else-if="failure"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="t('join.acceptFailedTitle')"
      :description="failure"
    />
    <UAlert
      v-else-if="!token || !preview?.valid"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="t('join.invalidTitle')"
      :description="t('join.invalidDescription')"
    />
    <template v-else>
      <div class="space-y-2">
        <h1 class="text-lg font-semibold">
          {{ t('join.heading', { organization: preview.organizationName }) }}
        </h1>
        <p class="text-sm text-muted leading-relaxed">
          {{ t('join.description', { email: preview.email }) }}
        </p>
      </div>
      <InvitationPassword
        :organization-name="preview.organizationName"
        :email="preview.email"
        :contact-name="preview.profile.contactName"
        :token="token"
        @created="claim()"
      />
    </template>
  </div>
</template>
