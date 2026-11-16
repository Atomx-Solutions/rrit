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
      <ul v-else class="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
        <li
          v-for="admin in administrators"
          :key="admin.user_id"
          class="group relative flex flex-col overflow-hidden rounded-lg border border-default bg-default transition-colors hover:border-accented"
          :class="admin.email === me?.email ? 'ring-1 ring-primary/40' : ''"
        >
          <div class="flex items-start gap-3 p-4">
            <UAvatar :alt="admin.name" size="lg" class="shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-1.5">
                <span class="truncate font-semibold text-highlighted">{{ admin.name }}</span>
                <UBadge v-if="admin.email === me?.email" color="primary" variant="subtle" size="sm" :label="t('admin.administrators.you')" />
              </p>
              <p class="truncate text-sm text-muted">{{ admin.email }}</p>
              <p
                class="mt-2 inline-flex items-center gap-1.5 text-xs font-medium"
                :class="admin.microsoft ? 'text-muted' : 'text-warning'"
              >
                <MicrosoftLogo v-if="admin.microsoft" class="size-3.5" />
                <UIcon v-else name="i-lucide-triangle-alert" class="size-3.5" />
                {{ admin.microsoft ? t('admin.administrators.microsoftLinked') : t('admin.administrators.microsoftMissing') }}
              </p>
            </div>
            <UButton
              v-if="admin.email !== me?.email"
              icon="i-lucide-user-minus"
              color="error"
              variant="ghost"
              size="sm"
              class="shrink-0"
              :aria-label="t('admin.administrators.remove')"
              @click="removing = admin"
            />
          </div>
          <dl class="mt-auto grid grid-cols-2 divide-x divide-default border-t border-default bg-elevated/50 text-xs">
            <div class="flex items-center gap-2 px-4 py-2.5">
              <UIcon name="i-lucide-calendar-plus" class="size-3.5 shrink-0 text-dimmed" />
              <div class="min-w-0">
                <dt class="text-dimmed">{{ t('admin.administrators.grantedLabel') }}</dt>
                <dd class="truncate font-medium text-default">{{ formatDay(admin.granted_at) }}</dd>
              </div>
            </div>
            <div class="flex items-center gap-2 px-4 py-2.5">
              <UIcon name="i-lucide-log-in" class="size-3.5 shrink-0 text-dimmed" />
              <div class="min-w-0">
                <dt class="text-dimmed">{{ t('admin.administrators.lastSignInLabel') }}</dt>
                <dd class="truncate font-medium text-default">{{ formatDay(admin.last_sign_in_at) }}</dd>
              </div>
            </div>
          </dl>
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
