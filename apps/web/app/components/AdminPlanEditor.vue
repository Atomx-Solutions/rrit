<script setup lang="ts">
export type AdminPlan = {
  code: string
  name: string
  monthly_cents: number
  posts_per_month: number
  monthly_credits: number
  style_fetch_post_count: number
  annual_discount_percent: number
  is_trial: boolean
  active: boolean
  sort_order: number
}

const props = defineProps<{ plan: AdminPlan | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const { t } = useI18n()
const toast = useToast()

const form = reactive({
  name: '',
  monthly_price: 0,
  posts_per_month: 0,
  monthly_credits: 0,
  style_fetch_post_count: 1,
  sort_order: 0,
  active: true,
})
watch(() => props.plan, (plan) => {
  if (!plan) return
  Object.assign(form, {
    name: plan.name,
    monthly_price: plan.monthly_cents / 100,
    posts_per_month: plan.posts_per_month,
    monthly_credits: plan.monthly_credits,
    style_fetch_post_count: plan.style_fetch_post_count,
    sort_order: plan.sort_order,
    active: plan.active,
  })
}, { immediate: true })

// Only fields that differ are sent, so the audit shows exactly what changed.
const changes = computed(() => {
  const plan = props.plan
  if (!plan) return {}
  const next: Record<string, unknown> = {
    name: form.name.trim(),
    monthly_cents: Math.round(Number(form.monthly_price) * 100),
    posts_per_month: Number(form.posts_per_month),
    monthly_credits: Number(form.monthly_credits),
    style_fetch_post_count: Number(form.style_fetch_post_count),
    sort_order: Number(form.sort_order),
    active: form.active,
  }
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => plan[key as keyof AdminPlan] !== value))
})
const saving = ref(false)
const error = ref('')
const { onFormError, watchError } = useFormFeedback()
watchError(error)

async function save() {
  if (!props.plan || !Object.keys(changes.value).length) return
  saving.value = true
  error.value = ''
  try {
    await $fetch(`/api/admin/plans/${props.plan.code}`, { method: 'PATCH', body: changes.value })
    toast.add({ title: t('admin.plans.saved'), color: 'success' })
    emit('saved')
    emit('close')
  } catch (problem) {
    error.value = (problem as { data?: { message?: string } }).data?.message || t('admin.plans.saveFailed')
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <UModal
    :open="!!plan"
    :title="plan ? t('admin.plans.editTitle', { name: plan.name }) : ''"
    :description="plan?.code"
    @update:open="(value: boolean) => { if (!value) emit('close') }"
  >
    <template #body>
      <UForm
        :state="form"
        class="grid gap-4 sm:grid-cols-2"
        @submit="save"
        @error="onFormError"
      >
        <UFormField name="name" :label="t('admin.plans.name')" class="sm:col-span-2" required>
          <UInput v-model="form.name" maxlength="120" class="w-full" />
        </UFormField>
        <UFormField
          name="monthly_price"
          :label="t('admin.plans.monthlyPrice')"
          :hint="plan?.is_trial ? t('admin.plans.trialFree') : undefined"
          required
        >
          <UInputNumber
            v-model="form.monthly_price"
            :min="plan?.is_trial ? 0 : 0.01"
            :max="plan?.is_trial ? 0 : 1000000"
            :step="0.01"
            :format-options="{ style: 'currency', currency: 'EUR' }"
            :disabled="plan?.is_trial"
            class="w-full"
          />
        </UFormField>
        <UFormField name="posts_per_month" :label="t('admin.plans.posts')" required>
          <UInputNumber v-model="form.posts_per_month" :min="0" :max="100000" class="w-full" />
        </UFormField>
        <UFormField name="monthly_credits" :label="t('admin.plans.credits')" required>
          <UInputNumber v-model="form.monthly_credits" :min="0" :max="100000000" class="w-full" />
        </UFormField>
        <UFormField name="style_fetch_post_count" :label="t('admin.plans.styleCount')" required>
          <UInputNumber v-model="form.style_fetch_post_count" :min="1" :max="100" class="w-full" />
        </UFormField>
        <UFormField name="sort_order" :label="t('admin.plans.sortOrder')" required>
          <UInputNumber v-model="form.sort_order" :min="0" :max="10000" class="w-full" />
        </UFormField>
        <UFormField name="active" :label="t('admin.plans.active')" :description="t('admin.plans.activeDescription')">
          <USwitch v-model="form.active" />
        </UFormField>
        <UAlert
          class="sm:col-span-2"
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :title="t('admin.plans.subscriptionsUnchanged')"
        />
        <UButton
          type="submit"
          class="sm:col-span-2"
          block
          :loading="saving"
          :disabled="!Object.keys(changes).length"
          :label="t('admin.plans.save')"
        />
      </UForm>
    </template>
  </UModal>
</template>
