<script setup lang="ts">
// Closing an organization: access ends at once, unused credits are forfeited
// without a refund, and it can be reopened until its content is removed.
// Invoices, payments and the credit history are always kept.
const props = defineProps<{
  organizationId: string
  organizationName: string
  status: string
  closure: { closed_at: string; close_reason: string | null; purge_after: string | null } | null
}>()
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n()
const toast = useToast()

const confirming = ref<'close' | 'reopen' | null>(null)
const reason = ref('')
const saving = ref(false)
const error = ref('')
const closed = computed(() => props.status === 'archived')
const reopenable = computed(() =>
  closed.value && !!props.closure?.purge_after && Date.parse(props.closure.purge_after) > Date.now())

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('sq-XK', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Belgrade' }).format(new Date(value))
}

const closeEffects = [
  { key: 'access', icon: 'i-lucide-lock', tone: 'text-error' },
  { key: 'credits', icon: 'i-lucide-coins', tone: 'text-error' },
  { key: 'publications', icon: 'i-lucide-calendar-x', tone: 'text-warning' },
  { key: 'kept', icon: 'i-lucide-receipt-text', tone: 'text-success' },
]
const reopenEffects = [
  { key: 'accessBack', icon: 'i-lucide-unlock', tone: 'text-success' },
  { key: 'notRestored', icon: 'i-lucide-info', tone: 'text-muted' },
]

function open(next: 'close' | 'reopen') {
  error.value = ''
  reason.value = ''
  confirming.value = next
}

async function submit() {
  if (!confirming.value) return
  if (confirming.value === 'close' && reason.value.trim().length < 3) {
    error.value = t('admin.closure.reasonRequired')
    return
  }
  saving.value = true
  error.value = ''
  try {
    await $fetch(`/api/admin/organizations/${props.organizationId}/${confirming.value}`, {
      method: 'POST',
      body: confirming.value === 'close' ? { reason: reason.value.trim() } : {},
    })
    toast.add({ title: t(`admin.closure.done.${confirming.value}`), color: 'success' })
    confirming.value = null
    emit('changed')
  } catch (problem) {
    error.value = t((problem as { data?: { message?: string } }).data?.message || 'admin.closure.failed')
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <div v-if="closed && closure" class="overflow-hidden rounded-lg border border-default">
    <div class="flex items-center gap-3 border-b border-default bg-warning/5 px-4 py-3">
      <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning/15">
        <UIcon name="i-lucide-lock" class="size-4 text-warning" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-highlighted">{{ t('admin.closure.badge') }}</p>
        <p class="text-xs text-muted">{{ formatDateTime(closure.closed_at) }}</p>
      </div>
      <UButton
        v-if="reopenable"
        icon="i-lucide-rotate-ccw"
        color="neutral"
        variant="outline"
        size="sm"
        class="shrink-0"
        :label="t('admin.closure.reopen')"
        @click="open('reopen')"
      />
    </div>
    <dl class="divide-y divide-default text-sm">
      <div class="grid gap-1 px-4 py-2.5 sm:grid-cols-[2fr_3fr]">
        <dt class="text-muted">{{ t('admin.closure.reason') }}</dt>
        <dd class="break-words text-default">{{ closure.close_reason || '—' }}</dd>
      </div>
      <div v-if="closure.purge_after" class="grid gap-1 px-4 py-2.5 sm:grid-cols-[2fr_3fr]">
        <dt class="text-muted">{{ t(reopenable ? 'admin.closure.reopenUntilLabel' : 'admin.closure.reopenEndedLabel') }}</dt>
        <dd class="text-default">
          {{ formatDateTime(closure.purge_after) }}
          <span v-if="reopenable" class="block text-xs text-muted">{{ t('admin.closure.purgeNote') }}</span>
        </dd>
      </div>
    </dl>
  </div>
  <div
    v-else
    class="flex flex-col gap-3 rounded-lg border border-error/25 p-4 sm:flex-row sm:items-center"
  >
    <div class="min-w-0 flex-1 space-y-0.5">
      <p class="text-sm font-semibold text-highlighted">{{ t('admin.closure.title') }}</p>
      <p class="text-xs text-muted">{{ t('admin.closure.explain') }}</p>
    </div>
    <UButton
      icon="i-lucide-archive-x"
      color="error"
      variant="soft"
      size="sm"
      class="shrink-0 self-start sm:self-center"
      :label="t('admin.closure.close')"
      @click="open('close')"
    />
  </div>
  <UModal
    :open="!!confirming"
    :title="confirming ? t(`admin.closure.confirmTitle.${confirming}`) : ''"
    :description="organizationName"
    :ui="{ footer: 'justify-end gap-2' }"
    @update:open="(value: boolean) => { if (!value) confirming = null }"
  >
    <template #body>
      <UForm id="organization-closure" :state="{ reason }" class="space-y-5" @submit="submit">
        <ul class="space-y-2.5">
          <li
            v-for="item in (confirming === 'close' ? closeEffects : reopenEffects)"
            :key="item.key"
            class="flex items-start gap-2.5 text-sm"
          >
            <UIcon :name="item.icon" class="mt-0.5 size-4 shrink-0" :class="item.tone" />
            <span class="text-default">{{ t(`admin.closure.effect.${item.key}`) }}</span>
          </li>
        </ul>
        <UFormField v-if="confirming === 'close'" name="reason" :label="t('admin.closure.reason')" :hint="`${reason.length}/500`" required>
          <UTextarea
            v-model="reason"
            :maxlength="500"
            :rows="3"
            autoresize
            :placeholder="t('admin.closure.reasonPlaceholder')"
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
      </UForm>
    </template>
    <template #footer>
      <UButton color="neutral" variant="ghost" :label="t('admin.closure.cancel')" @click="confirming = null" />
      <UButton
        type="submit"
        form="organization-closure"
        :loading="saving"
        :disabled="confirming === 'close' && reason.trim().length < 3"
        :color="confirming === 'close' ? 'error' : 'primary'"
        :icon="confirming === 'close' ? 'i-lucide-archive-x' : 'i-lucide-rotate-ccw'"
        :label="confirming ? t(`admin.closure.confirmButton.${confirming}`) : ''"
      />
    </template>
  </UModal>
</template>
