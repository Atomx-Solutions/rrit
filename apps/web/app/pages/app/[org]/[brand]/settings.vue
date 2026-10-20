<script setup lang="ts">
import { APP_LOCALES, TIMEZONE_OPTIONS } from '~~/shared/schemas/workspace'
import { z } from 'zod'
definePageMeta({ layout: 'dashboard', middleware: 'workspace' })
const { data, base, syncing, commit, notify, exportData } = useWorkspace()
const { setLocale, t } = useI18n()
useSeoMeta({ title: () => `${t('settings.title')} · Framic` })
const route = useRoute()
const tabNames = ['profile', 'preferences', 'security', 'organization']
const tab = computed({
  get: () =>
    typeof route.query.tab === 'string' && tabNames.includes(route.query.tab)
      ? route.query.tab
      : 'profile',
  set: (value: string) => {
    void navigateTo(
      { path: route.path, query: { ...route.query, tab: value === 'profile' ? undefined : value } },
      { replace: true },
    )
  },
})
const initialPreferences: {
  name: string
  email: string
  timezone: string
  locale: AppLocale
  contentLocale: AppLocale
  currency: 'EUR' | 'CHF'
} = {
  // The workspace schema already reads the former 'de-DE' locale as 'de-CH',
  // so the stored language and time zone are shown exactly as saved.
  ...data.value.preferences,
  contentLocale: data.value.preferences.contentLocale || data.value.preferences.locale,
}
const { form, clear, recovered, localError } = useDraft(`${base.value}:preferences`, initialPreferences)
watch(
  () => form.locale,
  (value) => {
    if (value) setLocale(value)
  },
)
const baseline = ref(JSON.stringify(form))
const dirty = computed(() => JSON.stringify(form) !== baseline.value)
const saved = ref(false)
const formError = ref('')
const { onFormError, watchError } = useFormFeedback()
watchError(formError)
watchError(localError, 'warning')
const leaveOpen = ref(false)
let resolveLeave: ((allow: boolean) => void) | undefined
const schema = z.object({
  name: z.string().trim().min(2, t('settings.nameRequired')).max(100),
  email: z.email(t('settings.emailInvalid')),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('sq', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, t('settings.timezoneInvalid')),
  locale: z.enum(APP_LOCALES),
  contentLocale: z.enum(APP_LOCALES),
  currency: z.enum(['CHF', 'EUR']),
})
async function save() {
  formError.value = ''
  const snapshot = { ...form }
  if (await commit((d) => (d.preferences = snapshot))) {
    notify(t('common.saved'))
    baseline.value = JSON.stringify(snapshot)
    saved.value = true
    formError.value = ''
    clear()
  } else {
    formError.value = t('settings.saveError')
  }
}
onBeforeRouteLeave(() => {
  if (!dirty.value || syncing.value) return true
  leaveOpen.value = true
  return new Promise<boolean>((resolve) => {
    resolveLeave = resolve
  })
})
function finishLeave(allow: boolean) {
  const resolve = resolveLeave
  resolveLeave = undefined
  leaveOpen.value = false
  resolve?.(allow)
}
function handleLeaveOpen(open: boolean) {
  if (!open && resolveLeave) finishLeave(false)
  else leaveOpen.value = open
}
function discardAndLeave() {
  finishLeave(true)
}
async function saveAndLeave() {
  await save()
  if (!dirty.value) finishLeave(true)
}
</script>
<template>
  <DashboardPage
    :title="t('settings.title')"
    :description="t('settings.description')"
    :toolbar-border="false"
  >
    <template #toolbar>
      <UTabs
        v-model="tab"
        :items="[
          { id: 'profile', label: t('settings.profile') },
          { id: 'preferences', label: t('settings.preferences') },
          { id: 'security', label: t('settings.security') },
          { id: 'organization', label: t('settings.organization') },
        ]"
        value-key="id"
        :content="false"
        variant="link"
        class="w-full"
        :ui="{ list: 'flex-wrap gap-1 border-b-0', trigger: 'grow-0 px-3 min-h-10' }"
      />
    </template>
    <UAlert
      v-if="recovered"
      color="neutral"
      variant="outline"
      icon="i-lucide-history"
      :title="t('settings.recoveredTitle')"
      :description="t('settings.recoveredDescription')"
      class="max-w-3xl"
    />
    <UCard class="max-w-3xl" :ui="{ body: 'p-5 sm:p-7' }"
      ><AccountSecurity v-if="tab === 'security'" /><UForm
        v-else
        :state="form"
        :schema="schema"
        class="space-y-6"
        @submit="save"
        @error="onFormError"
      >
        <template v-if="tab === 'profile'"
          ><div class="actions">
            <UAvatar :alt="form.name" size="xl" />
            <div class="space-y-1">
              <h2>{{ t('settings.yourProfile') }}</h2>
              <p class="small muted mt-1">{{ t('settings.businessAccount') }}</p>
            </div>
          </div>
          <UFormField :label="t('settings.fullName')" name="name" class="field"
            ><UInput
              v-model="form.name"
              class="w-full"
              required
              minlength="2"
              maxlength="100" /></UFormField
          ><UFormField :label="t('settings.email')" name="email" class="field"
            ><UInput v-model="form.email" class="w-full" type="email" required /><small
              >{{ t('settings.emailDescription') }}</small
            ></UFormField
          ></template
        ><template v-if="tab === 'preferences'"
          ><h2>{{ t('settings.languageRegion') }}</h2>
           <UFormField :label="t('settings.language')" name="locale" class="field"
            ><USelect
              v-model="form.locale"
              class="w-72 max-w-full"
              :items="[
                { label: t('settings.albanianKosovo'), value: 'sq-XK' },
                { label: t('settings.englishUnitedStates'), value: 'en-US' },
                { label: t('settings.germanSwitzerland'), value: 'de-CH' },
                { label: t('settings.italianSwitzerland'), value: 'it-CH' },
                { label: t('settings.frenchSwitzerland'), value: 'fr-CH' },
                { label: t('settings.turkishTurkey'), value: 'tr-TR' },
              ]"
            /></UFormField
          ><UFormField
            :label="t('settings.contentLanguage')"
            :description="t('settings.contentLanguageDescription')"
            name="contentLocale"
            class="field"
            ><USelect
              v-model="form.contentLocale"
              class="w-72 max-w-full"
              :items="[
                { label: t('settings.albanianKosovo'), value: 'sq-XK' },
                { label: t('settings.englishUnitedStates'), value: 'en-US' },
                { label: t('settings.germanSwitzerland'), value: 'de-CH' },
                { label: t('settings.italianSwitzerland'), value: 'it-CH' },
                { label: t('settings.frenchSwitzerland'), value: 'fr-CH' },
                { label: t('settings.turkishTurkey'), value: 'tr-TR' },
              ]"
            /></UFormField
><UFormField :label="t('settings.timezone')" name="timezone" class="field"
            ><USelect
              v-model="form.timezone"
              class="w-72 max-w-full"
              :items="TIMEZONE_OPTIONS.map(zone => ({ label: t(zone.labelKey), value: zone.value }))" /></UFormField
          ><UFormField :label="t('settings.currency')" name="currency" class="field"
            ><USelect
              v-model="form.currency"
              class="w-72 max-w-full"
              :items="[
                { label: t('settings.currencyChf'), value: 'CHF' },
                { label: t('settings.currencyEuro'), value: 'EUR' },
              ]"
            /></UFormField
          ></template
        ><template v-if="tab === 'organization'"
          ><h2>{{ t('settings.workspaceManagement') }}</h2>
          <div class="actions">
            <UButton :to="`${base}/brand`" variant="outline" color="neutral"
              >{{ t('settings.businessIdentity') }}</UButton
            ><UButton :to="`${base}/billing`" variant="outline" color="neutral"
              >{{ t('settings.planBilling') }}</UButton
            >
          </div>
          <USeparator class="divider" />
          <h3>{{ t('settings.workCopy') }}</h3>
          <p class="text-sm text-muted">
            {{ t('settings.workCopyDescription') }}
          </p>
          <UButton icon="i-lucide-download" variant="outline" @click="exportData"
            >{{ t('settings.exportData') }}</UButton
          >
        </template>
        <div
          v-if="['profile', 'preferences'].includes(tab)"
          class="flex flex-wrap items-center gap-4 border-t border-default pt-5"
        >
          <UButton
            variant="outline"
            type="submit"
            :loading="syncing"
            icon="i-lucide-save"
            style="align-self: flex-start"
            >{{ t('settings.saveChanges') }}</UButton
          ><span role="status" class="text-xs text-muted">{{
            dirty
              ? t('settings.unsavedChanges')
              : saved
                ? t('common.saved')
                : t('settings.preferencesSaved')
          }}</span>
        </div>
      </UForm></UCard
    >
    <UnsavedChangesModal
      :open="leaveOpen"
      :saving="syncing"
      @update:open="handleLeaveOpen"
      @save="saveAndLeave"
      @discard="discardAndLeave"
    />
  </DashboardPage>
</template>

