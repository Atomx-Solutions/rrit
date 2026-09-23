<script setup lang="ts">
type Subscription = { plan_code: string; status: string } | null
type Action = 'pause' | 'resume' | 'change_plan' | 'extend' | 'cancel'

const props = defineProps<{ organizationId: string; organizationName: string; subscription: Subscription }>()
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n()
const toast = useToast()
const { plans } = usePlanCatalog()

const current = computed(() => props.subscription?.status || '')
const managed = computed(() => ['trialing', 'active', 'past_due', 'paused'].includes(current.value))
// Only the actions that make sense for the current status:
// active -> pause, change plan, extend, cancel · paused -> resume, cancel ·
// trialing -> change plan, cancel. past_due is handled like active.
const items = computed(() => {
  const pause = { label: t('admin.subscription.pause'), icon: 'i-lucide-pause', onSelect: () => open('pause') }
  const resume = { label: t('admin.subscription.resume'), icon: 'i-lucide-play', onSelect: () => open('resume') }
  const changePlan = { label: t('admin.subscription.changePlan'), icon: 'i-lucide-package', onSelect: () => open('change_plan') }
  const extend = { label: t('admin.subscription.extend'), icon: 'i-lucide-calendar-plus', onSelect: () => open('extend') }
  const cancel = { label: t('admin.subscription.cancel'), icon: 'i-lucide-ban', color: 'error' as const, onSelect: () => open('cancel') }
  const main = current.value === 'paused'
    ? [resume]
    : current.value === 'trialing'
      ? [changePlan]
      : [pause, changePlan, extend]
  return [main, [cancel]]
})

const action = ref<Action | null>(null)
const form = reactive({
  reason: '',
  plan_code: '',
  billing_interval: 'monthly' as 'monthly' | 'annual',
  days: 30,
})
const saving = ref(false)
const error = ref('')
const { onFormError, watchError } = useFormFeedback()
watchError(error)
const planOptions = computed(() =>
  plans.value.filter(plan => !plan.isTrial).map(plan => ({ label: plan.name, value: plan.code })),
)

function open(next: Action) {
  error.value = ''
  form.reason = ''
  form.plan_code = props.subscription?.plan_code || ''
  form.days = 30
  action.value = next
}

async function submit() {
  if (!action.value) return
  const body
    = action.value === 'pause' ? { action: 'pause', ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) }
      : action.value === 'change_plan' ? { action: 'change_plan', plan_code: form.plan_code, billing_interval: form.billing_interval }
        : action.value === 'extend' ? { action: 'extend', days: Number(form.days) }
          : { action: action.value }
  saving.value = true
  error.value = ''
  try {
    await $fetch(`/api/admin/organizations/${props.organizationId}/subscription`, { method: 'PATCH', body })
    toast.add({ title: t('admin.subscription.saved'), color: 'success' })
    action.value = null
    emit('changed')
  } catch (problem) {
    error.value = (problem as { data?: { message?: string } }).data?.message || t('admin.subscription.failed')
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <UDropdownMenu v-if="managed" :items="items" :content="{ align: 'end' }">
    <UButton
      icon="i-lucide-ellipsis"
      color="neutral"
      variant="ghost"
      :aria-label="t('admin.subscription.actionsFor', { name: organizationName })"
    />
  </UDropdownMenu>
  <UModal
    :open="!!action"
    :title="action ? t(`admin.subscription.title.${action}`) : ''"
    :description="organizationName"
    @update:open="(value: boolean) => { if (!value) action = null }"
  >
    <template #body>
      <UForm :state="form" class="space-y-4" @submit="submit" @error="onFormError">
        <UFormField v-if="action === 'pause'" name="reason" :label="t('admin.subscription.reason')" :hint="t('admin.subscription.optional')">
          <UTextarea v-model="form.reason" :maxlength="300" :rows="3" class="w-full" />
        </UFormField>
        <template v-if="action === 'change_plan'">
          <UFormField name="plan_code" :label="t('admin.subscription.plan')" required>
            <USelect v-model="form.plan_code" :items="planOptions" class="w-full" />
          </UFormField>
          <UFormField name="billing_interval" :label="t('admin.subscription.interval')" required>
            <USelect
              v-model="form.billing_interval"
              :items="[
                { label: t('billing.monthly'), value: 'monthly' },
                { label: t('billing.annual'), value: 'annual' },
              ]"
              class="w-full"
            />
          </UFormField>
        </template>
        <UFormField v-if="action === 'extend'" name="days" :label="t('admin.subscription.days')" :hint="t('admin.subscription.daysHint')" required>
          <UInputNumber v-model="form.days" :min="1" :max="365" class="w-full" />
        </UFormField>
        <UAlert
          v-if="action === 'cancel' || action === 'resume'"
          :color="action === 'cancel' ? 'error' : 'neutral'"
          variant="subtle"
          :title="t(`admin.subscription.confirm.${action}`)"
        />
        <UButton
          type="submit"
          :loading="saving"
          :color="action === 'cancel' ? 'error' : 'primary'"
          :label="t('admin.subscription.confirmButton')"
          block
        />
      </UForm>
    </template>
  </UModal>
</template>
