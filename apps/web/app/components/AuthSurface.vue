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
onMounted(() => {
  hydrated.value = true
})
function errorText(problem: { code?: string; status?: number; message?: string }) {
  const normalizedCode = problem.code?.toLowerCase() || ''
  const normalizedMessage = problem.message?.toLowerCase() || ''
  if (
    normalizedCode === 'email_not_confirmed' ||
    normalizedCode === 'email_not_verified' ||
    normalizedMessage.includes('email not confirmed')
  ) {
    return 'Shko në emailin tënd dhe konfirmoje llogarinë përpara hyrjes. Kontrollo edhe dosjen Spam.'
  }
  const messages: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: 'Emaili ose fjalëkalimi nuk është i saktë.',
    EMAIL_NOT_VERIFIED: 'Konfirmo emailin përpara hyrjes. Kontrollo kutinë e emailit.',
    INVALID_TOKEN: 'Lidhja ka skaduar ose është përdorur. Kërko një lidhje të re.',
    TOKEN_EXPIRED: 'Lidhja ka skaduar. Kërko një lidhje të re.',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
      'Nuk mund të vazhdojmë me këtë adresë. Provo hyrjen ose rikuperimin.',
    PASSWORD_TOO_SHORT: 'Përdor të paktën 12 karaktere.',
  }
  return problem.status === 429
    ? 'Ke provuar disa herë. Prit pak dhe provo sërish.'
    : messages[problem.code || ''] || 'Veprimi nuk përfundoi. Kontrollo të dhënat dhe provo sërish.'
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
        callbackURL: '/onboarding',
      })
      if (result.error) error.value = errorText(result.error)
      else {
        const verificationRequired = capabilities.value?.emailVerificationRequired ?? true
        pendingEmail.value = verificationRequired ? state.email : ''
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
        callbackURL: '/onboarding',
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
  } catch {
    error.value = 'Lidhja me serverin dështoi. Provo sërish.'
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
    v-if="(mode === 'reset' && success) || mode === 'callback'"
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
