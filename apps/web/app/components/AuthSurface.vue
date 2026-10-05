<script setup lang="ts">
import { z } from 'zod'
import { authClient } from '~/utils/auth-client'
import { safeRedirect } from '~~/shared/utils/format'
import { hasPasswordSymbol, PASSWORD_MIN_LENGTH } from '~/utils/password-policy'

const props = defineProps<{
  mode: 'login' | 'signup' | 'forgot' | 'reset' | 'verify' | 'callback'
}>()
const route = useRoute()
const { t } = useI18n()
const { data: capabilities } = await useFetch('/api/capabilities')
const pendingEmail = useState('pending-verification-email', () => '')
const state = reactive({ name: '', email: pendingEmail.value, password: '', confirm: '' })
const schema = z
  .object({
    name:
      props.mode === 'signup'
        ? z.string().trim().min(2, t('auth.validationName')).max(100)
        : z.string(),
    email: props.mode === 'reset' ? z.string() : z.email(t('auth.validationEmail')),
    password: ['login', 'signup', 'reset'].includes(props.mode)
      ? z
          .string()
          .min(props.mode === 'login' ? 1 : PASSWORD_MIN_LENGTH, t('auth.validationPassword'))
          .max(128)
          .refine(
            (value) => props.mode === 'login' || hasPasswordSymbol(value),
            t('auth.validationPasswordSymbol'),
          )
      : z.string(),
    confirm: z.string(),
  })
  .refine((s) => props.mode !== 'reset' || s.password === s.confirm, {
    message: t('auth.validationPasswordMatch'),
    path: ['confirm'],
  })
const busy = ref(false)
const googleBusy = ref(false)
const error = ref('')
const success = ref('')
const showPassword = ref(false)
const hydrated = ref(false)
const { onFormError, showError, showSuccess, watchError } = useFormFeedback()
watchError(error)
watch(
  () => route.query.error,
  (value) => {
    if (value) showError(t('auth.connectionUnavailableDescription'), 'warning')
  },
  { immediate: true },
)
const available = computed(() => {
  if (props.mode === 'signup') return capabilities.value?.registration
  if (props.mode === 'forgot' || props.mode === 'verify')
    return capabilities.value?.passwordRecovery
  if (props.mode === 'callback') return true
  return capabilities.value?.authentication
})
onMounted(async () => {
  hydrated.value = true
  if (props.mode !== 'callback') return

  busy.value = true
  try {
    const result = await authClient.handleCallback()
    if (result.error) error.value = errorText(result.error)
    else if (!result.data.session)
      error.value = t('auth.callbackIncompleteError')
    else await navigateTo(safeRedirect(route.query.next, '/onboarding'), { replace: true })
  } catch (caught) {
    error.value = errorText({ message: caught instanceof Error ? caught.message : '' })
  } finally {
    busy.value = false
  }
})
function errorText(problem: {
  code?: string | undefined
  status?: number | undefined
  message?: string | undefined
}) {
  const normalizedCode = problem.code?.toLowerCase() || ''
  const normalizedMessage = problem.message?.toLowerCase() || ''
  if (normalizedMessage === 'supabase_not_configured') return t('auth.supabaseNotConfigured')
  if (
    problem.status === 429 ||
    normalizedCode.includes('rate_limit') ||
    normalizedCode.includes('too_many_requests') ||
    normalizedCode.includes('over_email_send_rate_limit')
  ) {
    return t('auth.rateLimitError')
  }
  if (
    normalizedCode.includes('email_not_confirmed') ||
    normalizedCode.includes('email_not_verified') ||
    normalizedCode.includes('user_not_confirmed') ||
    normalizedMessage.includes('email not confirmed') ||
    normalizedMessage.includes('email is not confirmed') ||
    normalizedMessage.includes('confirm your email') ||
    normalizedMessage.includes('verify your email')
  ) {
    return t('auth.emailNotConfirmedError')
  }
  if (
    normalizedCode === 'invalid_credentials' ||
    normalizedCode === 'invalid_login_credentials' ||
    normalizedMessage.includes('invalid login credentials') ||
    normalizedMessage.includes('invalid credentials')
  ) {
    return t('auth.invalidCredentialsError')
  }
  const messages: Record<string, string> = {
    invalid_email: t('auth.invalidEmailError'),
    email_address_invalid: t('auth.invalidEmailError'),
    invalid_email_or_password: t('auth.invalidCredentialsError'),
    email_not_verified: t('auth.emailNotVerifiedError'),
    invalid_token: t('auth.invalidTokenError'),
    token_expired: t('auth.tokenExpiredError'),
    otp_expired: t('auth.otpExpiredError'),
    pkce_code_verifier_not_found: t('auth.pkceError'),
    user_already_exists: t('auth.accountExistsError'),
    user_already_exists_use_another_email: t('auth.accountExistsOtherEmailError'),
    password_too_short: t('auth.passwordTooShortError'),
    weak_password: t('auth.weakPasswordError'),
    user_banned: t('auth.userBannedError'),
  }
  if (
    normalizedMessage.includes('invalid email') ||
    normalizedMessage.includes('email address is invalid')
  )
    return messages.invalid_email ?? t('auth.invalidEmailError')
  if (normalizedMessage.includes('already registered'))
    return messages.user_already_exists ?? t('auth.accountExistsError')
  if (normalizedMessage.includes('password') && normalizedMessage.includes('weak'))
    return messages.weak_password ?? t('auth.weakPasswordError')
  if (normalizedMessage.includes('fetch') || normalizedMessage.includes('network'))
    return t('auth.networkError')
  return messages[normalizedCode] || t('auth.genericError')
}
async function submit() {
  if (busy.value) return
  error.value = ''
  success.value = ''
  if (!available.value) {
    error.value =
      props.mode === 'signup'
        ? t('auth.signupUnavailableError')
        : props.mode === 'forgot' || props.mode === 'verify'
          ? t('auth.emailUnavailableError')
          : t('auth.loginUnavailableError')
    return
  }
  busy.value = true
  try {
    if (props.mode === 'signup') {
      const result = await authClient.signUp.email({
        name: state.name.trim(),
        email: state.email.trim(),
        password: state.password,
        callbackURL: '/auth/callback?next=/onboarding',
      })
      if (result.error) error.value = errorText(result.error)
      else {
        const verificationRequired =
          capabilities.value?.emailVerificationRequired === true || !result.data.session
        pendingEmail.value = verificationRequired ? state.email.trim() : ''
        state.password = ''
        clearNuxtData('account-sessions')
        await navigateTo(verificationRequired ? '/verify-email' : '/onboarding')
      }
    } else if (props.mode === 'login') {
      const result = await authClient.signIn.email({
        email: state.email.trim(),
        password: state.password,
      })
      if (result.error) error.value = errorText(result.error)
      else {
        state.password = ''
        await navigateTo('/app')
      }
    } else if (props.mode === 'forgot') {
      const result = await authClient.requestPasswordReset({
        email: state.email.trim(),
        redirectTo: '/reset-password',
      })
      if (result.error) error.value = errorText(result.error)
      else
        success.value = t('auth.recoveryRequested')
        showSuccess(success.value)
    } else if (props.mode === 'verify') {
      const result = await authClient.sendVerificationEmail({
        email: state.email.trim(),
        callbackURL: '/auth/callback?next=/onboarding',
      })
      if (result.error) error.value = errorText(result.error)
      else {
        success.value = t('auth.verificationRequested')
        showSuccess(success.value)
      }
    } else if (props.mode === 'reset') {
      const token = typeof route.query.token === 'string' ? route.query.token : ''
      if (!token) {
        error.value = t('auth.confirmPasswordLinkError')
        return
      }
      const result = await authClient.resetPassword({ token, newPassword: state.password })
      if (result.error) error.value = errorText(result.error)
      else {
        state.password = ''
        state.confirm = ''
        success.value = t('auth.passwordChanged')
        showSuccess(success.value)
      }
    }
  } catch (caught) {
    error.value = errorText({ message: caught instanceof Error ? caught.message : '' })
  } finally {
    busy.value = false
  }
}

async function continueWithGoogle() {
  if (busy.value || googleBusy.value || !available.value) return
  error.value = ''
  googleBusy.value = true
  try {
    const result = await authClient.signIn.google({
      // Supabase creates a new account for a first-time Google identity. Existing
      // identities sign in, so the same provider flow serves both screens.
      callbackURL: `/auth/callback?next=${props.mode === 'signup' ? '/onboarding' : '/app'}`,
    })
    if (result.error) error.value = errorText(result.error)
  } catch (caught) {
    error.value = errorText({ message: caught instanceof Error ? caught.message : '' })
  } finally {
    googleBusy.value = false
  }
}
</script>
<template>
  <h1>{{ t(`auth.title.${mode}`) }}</h1>
  <p>{{ t(`auth.description.${mode}`) }}</p>
  <UForm
    v-if="mode !== 'callback' && !(mode === 'reset' && success)"
    :schema="schema"
    :state="state"
    class="space-y-5"
    @submit="submit"
    @error="onFormError"
  >
    <UFormField v-if="mode === 'signup'" :label="t('settings.fullName')" name="name" required
      ><UInput
        v-model="state.name"
        :disabled="!hydrated || busy"
        autocomplete="name"
        class="w-full"
        :placeholder="t('auth.namePlaceholder')"
        maxlength="100"
    /></UFormField>
    <UFormField v-if="mode !== 'reset'" :label="t('common.email')" name="email" required
      ><UInput
        v-model="state.email"
        :disabled="!hydrated || busy"
        type="email"
        autocomplete="email"
        class="w-full"
        :placeholder="t('auth.emailPlaceholder')"
    /></UFormField>
    <UFormField
      v-if="['login', 'signup', 'reset'].includes(mode)"
      :label="t('legacy.password')"
      name="password"
      :description="
        mode === 'signup' || mode === 'reset'
          ? t('auth.passwordHint')
          : undefined
      "
      required
    >
      <UInput
        v-model="state.password"
        :disabled="!hydrated || busy"
        :type="showPassword ? 'text' : 'password'"
        :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
        class="w-full"
        :ui="{ trailing: 'pe-1' }"
        maxlength="128"
      >
        <template #trailing
          ><UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            :aria-label="showPassword ? t('auth.hidePassword') : t('auth.showPassword')"
            @click="showPassword = !showPassword"
        /></template>
      </UInput>
    </UFormField>
    <UFormField v-if="mode === 'reset'" :label="t('auth.confirmPassword')" name="confirm" required
      ><UInput
        v-model="state.confirm"
        :disabled="busy"
        type="password"
        autocomplete="new-password"
        class="w-full"
    /></UFormField>
    <div v-if="mode === 'login'" class="flex justify-end">
      <ULink to="/forgot-password" class="text-primary text-sm">{{ t('auth.forgotPasswordLink') }}</ULink>
    </div>
    <p v-if="mode === 'signup'" class="text-xs text-muted leading-relaxed">
      {{ t('auth.beforeSignup') }}
      <ULink to="/terms" target="_blank" class="text-primary underline underline-offset-2"
        >{{ t('auth.terms') }}</ULink
      >
      {{ t('auth.and') }}
      <ULink to="/privacy" target="_blank" class="text-primary underline underline-offset-2"
        >{{ t('auth.privacy') }}</ULink
      >.
    </p>
    <UButton
      :disabled="!hydrated"
      type="submit"
      block
      :loading="busy"
      size="lg"
      variant="outline"
      >{{
        mode === 'login'
          ? t('auth.loginButton')
          : mode === 'signup'
            ? t('auth.signupButton')
            : mode === 'forgot'
              ? t('auth.forgotButton')
              : mode === 'verify'
                ? t('auth.resendButton')
                : t('auth.savePasswordButton')
      }}</UButton
    >
    <div v-if="['login', 'signup'].includes(mode)" class="flex items-center gap-3">
      <div class="h-px flex-1 bg-default" />
      <span class="text-xs text-muted">{{ t('auth.or') }}</span>
      <div class="h-px flex-1 bg-default" />
    </div>
    <UButton
      v-if="['login', 'signup'].includes(mode)"
      type="button"
      :disabled="!hydrated || !available || busy"
      :loading="googleBusy"
      block
      size="lg"
      color="neutral"
      variant="outline"
      @click="continueWithGoogle"
    >
      <img src="/google-logo.svg" alt="" class="size-5 shrink-0" />
      {{ t('auth.continueWithGoogle') }}
    </UButton>
  </UForm>
  <UButton
    v-if="(mode === 'reset' && success) || (mode === 'callback' && error)"
    to="/login"
    block
    variant="outline"
    >{{ t('auth.continueLogin') }}</UButton
  >
  <p v-if="mode === 'signup' && capabilities?.trialHours" class="text-sm text-muted mt-5">
    {{ t('auth.trialDescription') }}
  </p>
  <p class="text-center text-sm text-muted mt-6">
    <template v-if="mode === 'login'"
      >{{ t('auth.newHere') }}<ULink to="/signup" class="text-primary">{{ t('auth.startBusiness') }}</ULink></template
    ><template v-else
      >{{ t('auth.haveAccount') }}<ULink to="/login" class="text-primary">{{ t('auth.backToLogin') }}</ULink></template
    >
  </p>
</template>
