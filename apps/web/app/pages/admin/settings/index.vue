<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t, locale, setLocale } = useI18n()
const { onFormError, showError, watchError } = useFormFeedback()
useSeoMeta({ title: () => `${t('admin.nav.settings')} · Rrit Admin`, robots: 'noindex, nofollow' })

type Settings = { ai_top_up_url: string, ai_warn_balance_usd: number, ai_low_balance_usd: number, custom_package_post_price_cents: number, custom_package_credits_per_post: number, package_request_post_options: number[] }
const toast = useToast()
const { data, status, error, refresh } = await useFetch<Settings>('/api/admin/settings', { lazy: true })
watch(error, (value) => {
  if (value) showError(t('admin.settings.loadError'))
}, { immediate: true })

const form = reactive({ ai_top_up_url: '', ai_warn_balance_usd: 30, ai_low_balance_usd: 10 })
watch(data, (value) => {
  if (value) Object.assign(form, { ai_top_up_url: value.ai_top_up_url, ai_warn_balance_usd: value.ai_warn_balance_usd, ai_low_balance_usd: value.ai_low_balance_usd })
}, { immediate: true })
const changed = computed(() =>
  !!data.value && (form.ai_top_up_url !== data.value.ai_top_up_url
    || Number(form.ai_warn_balance_usd) !== data.value.ai_warn_balance_usd
    || Number(form.ai_low_balance_usd) !== data.value.ai_low_balance_usd))

const saving = ref(false)
const saveError = ref('')
watchError(saveError)
async function save() {
  if (!changed.value) return
  saving.value = true
  saveError.value = ''
  try {
    await $fetch('/api/admin/settings', {
      method: 'PATCH',
      body: {
        ai_top_up_url: form.ai_top_up_url.trim(),
        ai_warn_balance_usd: Number(form.ai_warn_balance_usd),
        ai_low_balance_usd: Number(form.ai_low_balance_usd),
      },
    })
    await refresh()
    toast.add({ title: t('admin.settings.saved'), color: 'success' })
  } catch (problem) {
    saveError.value = (problem as { data?: { message?: string } }).data?.message || t('admin.settings.saveFailed')
  } finally {
    saving.value = false
  }
}

// The per-post rate behind custom package suggestions. It is a commercial
// setting rather than an AI one, so it lives in its own card and saves alone.
const packageForm = reactive({ post_price_euro: 1.5, credits_per_post: 80, post_options: '10, 20, 30' })
watch(data, (value) => {
  if (!value) return
  packageForm.post_price_euro = value.custom_package_post_price_cents / 100
  packageForm.credits_per_post = value.custom_package_credits_per_post
  packageForm.post_options = value.package_request_post_options.join(', ')
}, { immediate: true })
const packagePriceCents = computed(() => Math.round(packageForm.post_price_euro * 100))
// Whatever the admin types, only whole positive numbers reach the setting.
const postOptions = computed(() => [
  ...new Set(
    packageForm.post_options
      .split(',')
      .map(part => Number(part.trim()))
      .filter(value => Number.isInteger(value) && value > 0 && value <= 1000),
  ),
].sort((a, b) => a - b))
const packageChanged = computed(() =>
  !!data.value
  && (packagePriceCents.value !== data.value.custom_package_post_price_cents
    || Number(packageForm.credits_per_post) !== data.value.custom_package_credits_per_post
    || postOptions.value.join(',') !== data.value.package_request_post_options.join(',')))
const savingPackage = ref(false)
async function savePackageRate() {
  if (!packageChanged.value) return
  savingPackage.value = true
  saveError.value = ''
  try {
    await $fetch('/api/admin/settings', {
      method: 'PATCH',
      body: {
        custom_package_post_price_cents: packagePriceCents.value,
        custom_package_credits_per_post: Number(packageForm.credits_per_post),
        ...(postOptions.value.length ? { package_request_post_options: postOptions.value } : {}),
      },
    })
    await refresh()
    toast.add({ title: t('admin.settings.saved'), color: 'success' })
  } catch (problem) {
    saveError.value = (problem as { data?: { message?: string } }).data?.message || t('admin.settings.saveFailed')
  } finally {
    savingPackage.value = false
  }
}

// The same two languages as the customer app; the choice is per admin.
const languageOptions = computed(() => [
  { label: t('admin.settings.albanian'), value: 'sq-XK' },
  { label: t('admin.settings.english'), value: 'en-US' },
])
const language = computed({
  get: () => locale.value,
  set: (value: string) => setLocale(value),
})
</script>

<template>
  <AdminPage :title="t('admin.nav.settings')">
    <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5' }">
        <template #header>
          <UUser
            :name="t('admin.settings.language')"
            :description="t('admin.settings.languageHint')"
            :avatar="{ icon: 'i-lucide-languages', size: 'sm' }"
          />
        </template>
        <USelect v-model="language" :items="languageOptions" :aria-label="t('admin.settings.language')" class="w-full sm:w-64" />
      </UCard>

      <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5' }">
        <template #header>
          <UUser
            :name="t('admin.settings.packageRate')"
            :description="t('admin.settings.packageRateHint')"
            :avatar="{ icon: 'i-lucide-tag', size: 'sm' }"
          />
        </template>
        <UForm :state="packageForm" class="space-y-4" @submit="savePackageRate" @error="onFormError">
          <UFormField
            name="post_options"
            :label="t('admin.settings.requestOptions')"
            :hint="t('admin.settings.requestOptionsHint')"
          >
            <UInput v-model="packageForm.post_options" :maxlength="60" class="w-full sm:w-64" />
          </UFormField>
          <UButton
            type="submit"
            :loading="savingPackage"
            :disabled="!packageChanged"
            :label="t('admin.settings.save')"
          />
        </UForm>
      </UCard>

      <UCard class="shrink-0" :ui="{ header: 'px-4 py-3 sm:px-5', body: 'p-4 sm:p-5 space-y-4' }">
        <template #header>
          <UUser
            :name="t('admin.settings.aiCredit')"
            :description="t('admin.settings.aiCreditHint')"
            :avatar="{ icon: 'i-lucide-wallet', size: 'sm' }"
          />
        </template>
        <UForm :state="form" class="space-y-4" @submit="save" @error="onFormError">
          <UFormField name="ai_top_up_url" :label="t('admin.settings.topUpUrl')" :hint="t('admin.settings.topUpUrlHint')">
            <UInput
              v-model="form.ai_top_up_url"
              type="url"
              icon="i-lucide-link"
              placeholder="https://openrouter.ai/settings/credits"
              :loading="status === 'pending' && !data"
              class="w-full"
            />
          </UFormField>
          <UFormField name="ai_warn_balance_usd" :label="t('admin.settings.warnBalance')" :hint="t('admin.settings.warnBalanceHint')">
            <UInputNumber v-model="form.ai_warn_balance_usd" :min="0" :max="100000" :step="1" class="w-full sm:w-48" />
          </UFormField>
          <UFormField name="ai_low_balance_usd" :label="t('admin.settings.lowBalance')" :hint="t('admin.settings.lowBalanceHint')">
            <UInputNumber v-model="form.ai_low_balance_usd" :min="0" :max="100000" :step="1" class="w-full sm:w-48" />
          </UFormField>
          <UFieldGroup class="flex flex-wrap items-center gap-2">
            <UButton type="submit" :loading="saving" :disabled="!changed" :label="t('admin.settings.save')" />
            <UButton
              v-if="data?.ai_top_up_url"
              :to="data.ai_top_up_url"
              external
              target="_blank"
              color="neutral"
              variant="outline"
              icon="i-lucide-external-link"
              :label="t('admin.settings.openTopUp')"
            />
          </UFieldGroup>
        </UForm>
      </UCard>
  </AdminPage>
</template>
