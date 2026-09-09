<script setup lang="ts">
import { z } from 'zod'
import { authClient } from '~/utils/auth-client'
import { safeRedirect } from '~~/shared/utils/format'

const props = defineProps<{
  mode: 'login' | 'signup' | 'forgot' | 'reset' | 'verify' | 'callback'
}>()
const route = useRoute()
const { data: capabilities } = await useFetch('/api/capabilities')
const pendingEmail = useState('pending-verification-email', () => '')
const state = reactive({ name: '', email: pendingEmail.value, password: '', confirm: '' })
const titles = {
  login: 'Mirë se u ktheve.',
  signup: 'Regjistro biznesin tënd.',
  forgot: 'Rikthe aksesin tënd.',
  reset: 'Një fjalëkalim i ri.',
  verify: 'Kontrollo emailin tënd.',
  callback: 'Vazhdo me biznesin tënd.',
}
const descriptions = {
  login: 'Hyr në hapësirën tënde dhe vazhdo aty ku e le.',
  signup: 'Krijo llogarinë. Pastaj të udhëzojmë për biznesin dhe postimin e parë.',
  forgot: 'Të dërgojmë një lidhje për të vendosur fjalëkalim të ri.',
  reset: 'Zgjidh një fjalëkalim me të paktën 12 karaktere.',
  verify: 'Hape lidhjen në email për ta konfirmuar llogarinë. Kontrollo edhe dosjen Spam.',
  callback: 'Hyr në llogari për të përfunduar konfigurimin.',
}
const schema = z
  .object({
    name:
      props.mode === 'signup'
        ? z.string().trim().min(2, 'Vendos emrin tënd.').max(100)
        : z.string(),
    email: props.mode === 'reset' ? z.string() : z.email('Vendos një adresë emaili të vlefshme.'),
    password: ['login', 'signup', 'reset'].includes(props.mode)
      ? z
          .string()
          .min(props.mode === 'login' ? 1 : 12, 'Përdor të paktën 12 karaktere.')
          .max(128)
      : z.string(),
    confirm: z.string(),
  })
  .refine((s) => props.mode !== 'reset' || s.password === s.confirm, {
    message: 'Fjalëkalimet nuk përputhen.',
    path: ['confirm'],
  })
const busy = ref(false)
const error = ref('')
const success = ref('')
const showPassword = ref(false)
const hydrated = ref(false)
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
      error.value = 'Lidhja nuk u përfundua. Kërko një email të ri konfirmimi dhe provo sërish.'
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
  if (
    problem.status === 429 ||
    normalizedCode.includes('rate_limit') ||
    normalizedCode.includes('too_many_requests') ||
    normalizedCode.includes('over_email_send_rate_limit')
  ) {
    return 'Ke provuar disa herë. Prit pak dhe provo sërish.'
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
    return 'Shko në emailin tënd dhe konfirmoje llogarinë përpara hyrjes. Kontrollo edhe dosjen Spam.'
  }
  if (
    normalizedCode === 'invalid_credentials' ||
    normalizedCode === 'invalid_login_credentials' ||
    normalizedMessage.includes('invalid login credentials') ||
    normalizedMessage.includes('invalid credentials')
  ) {
    return 'Emaili ose fjalëkalimi nuk është i saktë.'
  }
  const messages: Record<string, string> = {
    invalid_email: 'Vendos një adresë emaili të vlefshme.',
    email_address_invalid: 'Vendos një adresë emaili të vlefshme.',
    invalid_email_or_password: 'Emaili ose fjalëkalimi nuk është i saktë.',
    email_not_verified: 'Konfirmo emailin përpara hyrjes. Kontrollo kutinë e emailit.',
    invalid_token: 'Lidhja ka skaduar ose është përdorur. Kërko një lidhje të re.',
    token_expired: 'Lidhja ka skaduar. Kërko një lidhje të re.',
    otp_expired: 'Kodi ose lidhja ka skaduar. Kërko një lidhje të re.',
    pkce_code_verifier_not_found:
      'Hape linkun në të njëjtin browser ku e krijove llogarinë ose kërko një link të ri.',
    user_already_exists: 'Kjo adresë ka tashmë një llogari. Provo hyrjen ose rikuperimin.',
    user_already_exists_use_another_email:
      'Nuk mund të vazhdojmë me këtë adresë. Provo hyrjen ose rikuperimin.',
    password_too_short: 'Përdor të paktën 12 karaktere.',
    weak_password: 'Zgjidh një fjalëkalim më të fortë me të paktën 12 karaktere.',
    user_banned: 'Kjo llogari nuk mund të përdoret për momentin.',
  }
  if (
    normalizedMessage.includes('invalid email') ||
    normalizedMessage.includes('email address is invalid')
  )
    return messages.invalid_email ?? 'Vendos një adresë emaili të vlefshme.'
  if (normalizedMessage.includes('already registered'))
    return messages.user_already_exists ?? 'Kjo adresë ka tashmë një llogari.'
  if (normalizedMessage.includes('password') && normalizedMessage.includes('weak'))
    return messages.weak_password ?? 'Zgjidh një fjalëkalim më të fortë.'
  if (normalizedMessage.includes('fetch') || normalizedMessage.includes('network'))
    return 'Lidhja me serverin dështoi. Kontrollo internetin dhe provo sërish.'
  return messages[normalizedCode] || 'Veprimi nuk përfundoi. Kontrollo të dhënat dhe provo sërish.'
}
async function submit() {
  if (busy.value) return
  error.value = ''
  success.value = ''
  if (!available.value) {
    error.value =
      props.mode === 'signup'
        ? 'Regjistrimi nuk është i disponueshëm për momentin. Provo përsëri më vonë.'
        : props.mode === 'forgot' || props.mode === 'verify'
          ? 'Dërgimi i emailit nuk është i disponueshëm për momentin.'
          : 'Hyrja nuk është e disponueshme për momentin. Provo përsëri më vonë.'
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
        await navigateTo(safeRedirect(route.query.redirect))
      }
    } else if (props.mode === 'forgot') {
      const result = await authClient.requestPasswordReset({
        email: state.email.trim(),
        redirectTo: '/reset-password',
      })
      if (result.error) error.value = errorText(result.error)
      else
        success.value = 'Nëse kjo adresë ka llogari, do të marrë një email me hapat e rikuperimit.'
    } else if (props.mode === 'verify') {
      const result = await authClient.sendVerificationEmail({
        email: state.email.trim(),
        callbackURL: '/auth/callback?next=/onboarding',
      })
      if (result.error) error.value = errorText(result.error)
      else success.value = 'Nëse llogaria pret verifikim, lidhja do të mbërrijë në email.'
    } else if (props.mode === 'reset') {
      const token = typeof route.query.token === 'string' ? route.query.token : ''
      if (!token) {
        error.value = 'Hape lidhjen nga emaili për ta ndryshuar fjalëkalimin.'
        return
      }
      const result = await authClient.resetPassword({ token, newPassword: state.password })
      if (result.error) error.value = errorText(result.error)
      else {
        state.password = ''
        state.confirm = ''
        success.value = 'Fjalëkalimi u ndryshua. Tani mund të hysh në llogari.'
      }
    }
  } catch (caught) {
    error.value = errorText({ message: caught instanceof Error ? caught.message : '' })
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <h1>{{ titles[mode] }}</h1>
  <p>{{ descriptions[mode] }}</p>
  <UAlert v-if="error" color="error" variant="outline" :title="error" class="mb-5" />
  <UAlert v-if="success" color="success" variant="outline" :title="success" class="mb-5" />
  <UAlert
    v-if="route.query.error"
    color="warning"
    variant="outline"
    title="Lidhja nuk mund të përdoret"
    description="Kërko një lidhje të re dhe provo sërish."
    class="mb-5"
  />
  <UForm
    v-if="mode !== 'callback' && !(mode === 'reset' && success)"
    :schema="schema"
    :state="state"
    class="space-y-5"
    @submit="submit"
  >
    <UFormField v-if="mode === 'signup'" label="Emri i plotë" name="name" required
      ><UInput
        v-model="state.name"
        :disabled="!hydrated || busy"
        autocomplete="name"
        class="w-full"
        placeholder="Emri yt"
        maxlength="100"
    /></UFormField>
    <UFormField v-if="mode !== 'reset'" label="Email" name="email" required
      ><UInput
        v-model="state.email"
        :disabled="!hydrated || busy"
        type="email"
        autocomplete="email"
        class="w-full"
        placeholder="emri@biznesi.com"
    /></UFormField>
    <UFormField
      v-if="['login', 'signup', 'reset'].includes(mode)"
      label="Fjalëkalimi"
      name="password"
      :description="
        mode === 'signup'
          ? 'Të paktën 12 karaktere. Mund të përdorësh një fjali të gjatë.'
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
            :aria-label="showPassword ? 'Fshih fjalëkalimin' : 'Shfaq fjalëkalimin'"
            @click="showPassword = !showPassword"
        /></template>
      </UInput>
    </UFormField>
    <UFormField v-if="mode === 'reset'" label="Konfirmo fjalëkalimin" name="confirm" required
      ><UInput
        v-model="state.confirm"
        :disabled="busy"
        type="password"
        autocomplete="new-password"
        class="w-full"
    /></UFormField>
    <div v-if="mode === 'login'" class="flex justify-end">
      <ULink to="/forgot-password" class="text-primary text-sm">Ke harruar fjalëkalimin?</ULink>
    </div>
    <p v-if="mode === 'signup'" class="text-xs text-muted leading-relaxed">
      Para regjistrimit, lexo
      <ULink to="/terms" target="_blank" class="text-primary underline underline-offset-2"
        >kushtet</ULink
      >
      dhe
      <ULink to="/privacy" target="_blank" class="text-primary underline underline-offset-2"
        >privatësinë</ULink
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
          ? 'Hyr në llogari'
          : mode === 'signup'
            ? 'Krijo llogarinë e biznesit'
            : mode === 'forgot'
              ? 'Kërko lidhjen e rikuperimit'
              : mode === 'verify'
                ? 'Dërgo lidhjen sërish'
                : 'Ruaj fjalëkalimin'
      }}</UButton
    >
  </UForm>
  <UButton
    v-if="(mode === 'reset' && success) || (mode === 'callback' && error)"
    to="/login"
    block
    variant="outline"
    >Vazhdo te hyrja</UButton
  >
  <p v-if="mode === 'signup' && capabilities?.trialHours" class="text-sm text-muted mt-5">
    Trial falas për {{ capabilities.trialHours / 24 }} ditë pas krijimit të biznesit. Pa kartë
    bankare. Një trial për përdorues dhe identitete të lidhura.
  </p>
  <p class="text-center text-sm text-muted mt-6">
    <template v-if="mode === 'login'"
      >Je i ri këtu? <ULink to="/signup" class="text-primary">Nis me biznesin tënd</ULink></template
    ><template v-else
      >Ke një llogari? <ULink to="/login" class="text-primary">Kthehu te hyrja</ULink></template
    >
  </p>
</template>
