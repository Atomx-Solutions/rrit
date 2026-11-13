<script setup lang="ts">
import { z } from 'zod'

definePageMeta({ layout: 'admin', middleware: 'superadmin' })
const { t, locale } = useI18n()
const { showError, showSuccess, onFormError } = useFormFeedback()
useSeoMeta({ title: () => `${t('admin.nav.administrators')} · Framic Admin`, robots: 'noindex, nofollow' })

type Administrator = {
  user_id: string
  email: string
  name: string
  granted_at: string
  granted_by_email: string | null
  last_sign_in_at: string | null
  microsoft: boolean
}

const { data, status, error, refresh } = await useFetch<{ administrators: Administrator[] }>(
  '/api/admin/administrators',
  { lazy: true },
)
watch(error, (value) => {
  if (value) showError(t('admin.administrators.loadError'))
}, { immediate: true })
// Same key as the admin layout, so this costs no extra request.
const { data: me } = await useFetch('/api/admin/me', { key: 'admin-me', lazy: true })
const administrators = computed(() => data.value?.administrators ?? [])

function formatDay(value: string | null) {
  return value ? new Date(value).toLocaleDateString(locale.value, { dateStyle: 'medium' }) : '—'
}

// The database explains a refusal with a stable code; each has its own text.
const knownFailures = [
  'ADMIN_ACCOUNT_NOT_FOUND',
  'ADMIN_ALREADY_EXISTS',
  'ADMIN_CANNOT_REMOVE_SELF',
  'ADMIN_LAST_REMAINING',
  'ADMIN_NOT_FOUND',
] as const
function failureText(problem: unknown, fallback: string) {
  const code = (problem as { data?: { data?: { code?: string } } }).data?.data?.code
  return code && (knownFailures as readonly string[]).includes(code)
    ? t(`admin.administrators.error.${code}`)
    : fallback
}

const schema = z.object({ email: z.email(t('auth.validationEmail')).max(320) })
const form = reactive({ email: '' })
const addOpen = ref(false)
const adding = ref(false)
function openAdd() {
  form.email = ''
  addOpen.value = true
}
async function add() {
  adding.value = true
  try {
    await $fetch('/api/admin/administrators', { method: 'POST', body: { email: form.email.trim() } })
    showSuccess(t('admin.administrators.added'))
    addOpen.value = false
    form.email = ''
    await refresh()
  } catch (problem) {
    showError(failureText(problem, t('admin.administrators.addError')))
  } finally {
    adding.value = false
  }
}

const removing = ref<Administrator | null>(null)
const busy = ref(false)
async function confirmRemove() {
  if (!removing.value || busy.value) return
  busy.value = true
  try {
    await $fetch(`/api/admin/administrators/${removing.value.user_id}`, { method: 'DELETE', body: {} })
    showSuccess(t('admin.administrators.removed'))
    removing.value = null
    await refresh()
  } catch (problem) {
    showError(failureText(problem, t('admin.administrators.removeError')))
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <AdminPage :title="t('admin.nav.administrators')">
    <UCard class="shrink-0" :ui="{ header: 'px-4 py-4 sm:px-5', body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <p class="flex items-center gap-2 font-semibold text-highlighted">
              {{ t('admin.administrators.listTitle') }}
              <UBadge v-if="administrators.length" color="neutral" variant="subtle" size="sm" :label="String(administrators.length)" />
            </p>
            <p class="mt-1 text-sm text-muted">{{ t('admin.administrators.listHint') }}</p>
          </div>
          <UButton icon="i-lucide-user-plus" class="shrink-0 self-start sm:self-center" :label="t('admin.administrators.addTitle')" @click="openAdd" />
        </div>
      </template>

      <div v-if="status === 'pending' && !data" class="space-y-3 p-4 sm:p-5">
        <USkeleton v-for="index in 2" :key="index" class="h-12 w-full" />
      </div>
      <UEmpty
        v-else-if="error"
        class="py-10"
        icon="i-lucide-triangle-alert"
        :title="t('admin.administrators.loadError')"
        :actions="[{ label: t('admin.administrators.retry'), icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'subtle', onClick: () => refresh() }]"
      />
      <UEmpty
        v-else-if="!administrators.length"
        class="py-10"
        icon="i-lucide-shield-check"
        :title="t('admin.administrators.empty')"
      />
      <ul v-else class="divide-y divide-default">
        <li
          v-for="admin in administrators"
          :key="admin.user_id"
          class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
        >
          <UUser
            :name="admin.name"
            :description="admin.email"
            :avatar="{ alt: admin.name, size: 'md' }"
            class="min-w-0 flex-1"
            :ui="{ wrapper: 'min-w-0', name: 'truncate', description: 'truncate' }"
          >
            <template #name>
              <span class="flex flex-wrap items-center gap-1.5">
                <span class="truncate">{{ admin.name }}</span>
                <UBadge v-if="admin.email === me?.email" color="primary" variant="subtle" size="sm" :label="t('admin.administrators.you')" />
                <UBadge
                  v-if="admin.microsoft"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  icon="i-simple-icons-microsoft"
                  :label="t('admin.administrators.microsoftLinked')"
                />
                <UBadge v-else color="warning" variant="subtle" size="sm" icon="i-lucide-triangle-alert" :label="t('admin.administrators.microsoftMissing')" />
              </span>
            </template>
          </UUser>
          <dl class="grid shrink-0 grid-cols-2 gap-x-6 gap-y-0.5 text-xs sm:text-right">
            <dt class="text-dimmed">{{ t('admin.administrators.grantedLabel') }}</dt>
            <dt class="text-dimmed">{{ t('admin.administrators.lastSignInLabel') }}</dt>
            <dd class="text-muted">{{ formatDay(admin.granted_at) }}</dd>
            <dd class="text-muted">{{ formatDay(admin.last_sign_in_at) }}</dd>
          </dl>
          <div class="flex shrink-0 justify-end sm:w-24">
            <UButton
              v-if="admin.email !== me?.email"
              icon="i-lucide-user-minus"
              color="error"
              variant="soft"
              size="sm"
              :label="t('admin.administrators.removeShort')"
              :aria-label="t('admin.administrators.remove')"
              @click="removing = admin"
            />
          </div>
        </li>
      </ul>
    </UCard>

    <UModal
      v-model:open="addOpen"
      :dismissible="!adding"
      :title="t('admin.administrators.addTitle')"
      :description="t('admin.administrators.addHint')"
    >
      <template #body>
        <UForm id="add-administrator" :schema="schema" :state="form" @submit="add" @error="onFormError">
          <UFormField name="email" :label="t('admin.administrators.email')">
            <UInput
              v-model="form.email"
              type="email"
              icon="i-lucide-mail"
              autocomplete="off"
              autofocus
              :placeholder="t('admin.administrators.emailPlaceholder')"
              class="w-full"
            />
          </UFormField>
        </UForm>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="adding" @click="addOpen = false">
            {{ t('admin.requests.cancel') }}
          </UButton>
          <UButton type="submit" form="add-administrator" icon="i-lucide-user-plus" :loading="adding">
            {{ t('admin.administrators.add') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      :open="!!removing"
      :dismissible="!busy"
      :title="t('admin.administrators.remove')"
      :description="removing ? t('admin.administrators.removeConfirm', { email: removing.email }) : ''"
      @update:open="(value) => { if (!value) removing = null }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="busy" @click="removing = null">
            {{ t('admin.requests.cancel') }}
          </UButton>
          <UButton color="error" icon="i-lucide-user-minus" :loading="busy" @click="confirmRemove">
            {{ t('admin.administrators.remove') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </AdminPage>
</template>
