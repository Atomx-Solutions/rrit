<script setup lang="ts">
/**
 * What the team can do to the package an organization holds. Packages replaced
 * subscriptions, so these act on the package itself: its period and whether it
 * still stands. Changing what is in it is done in the organization's package
 * list, where the amounts and the price live.
 */
export type ActionablePackage = {
  id: string
  name: string
  ends_at: string
  status: 'draft' | 'active' | 'expired' | 'cancelled'
  in_force: boolean
} | null

const props = defineProps<{
  organizationId: string
  organizationName: string
  package: ActionablePackage
}>()
const emit = defineEmits<{ changed: []; edit: [] }>()
const { t } = useI18n()
const toast = useToast()
const { onFormError, watchError } = useFormFeedback()

type Action = 'extend' | 'activate' | 'cancel'
const action = ref<Action | null>(null)
const days = ref(30)
const saving = ref(false)
const error = ref('')
watchError(error)

// An organization with no package at all has nothing to act on yet; the package
// is created from its package list.
const items = computed(() => {
  const held = props.package
  if (!held) return []
  const edit = {
    label: t('admin.packageActions.edit'),
    icon: 'i-lucide-package',
    onSelect: () => emit('edit'),
  }
  const extend = {
    label: t('admin.packageActions.extend'),
    icon: 'i-lucide-calendar-plus',
    onSelect: () => open('extend'),
  }
  const activate = {
    label: t('admin.packageActions.activate'),
    icon: 'i-lucide-play',
    onSelect: () => open('activate'),
  }
  const cancel = {
    label: t('admin.packageActions.cancel'),
    icon: 'i-lucide-ban',
    color: 'error' as const,
    onSelect: () => open('cancel'),
  }
  const main = held.status === 'active' ? [edit, extend] : [edit, activate]
  return [main, held.status === 'cancelled' ? [] : [cancel]].filter(group => group.length)
})

function open(next: Action) {
  error.value = ''
  days.value = 30
  action.value = next
}

async function submit() {
  const held = props.package
  if (!held || !action.value) return
  saving.value = true
  error.value = ''
  // Extending moves the end of the period; the other two only change what the
  // package claims about itself.
  const body
    = action.value === 'extend'
      ? {
          ends_at: new Date(
            Math.max(Date.parse(held.ends_at), Date.now()) + days.value * 86400000,
          ).toISOString(),
          ...(held.status === 'active' ? {} : { status: 'active' as const }),
        }
      : { status: action.value === 'activate' ? ('active' as const) : ('cancelled' as const) }
  try {
    await $fetch(`/api/admin/organizations/${props.organizationId}/packages/${held.id}`, {
      method: 'PATCH',
      body,
    })
    toast.add({ title: t('admin.packageActions.saved'), color: 'success' })
    action.value = null
    emit('changed')
  } catch (problem) {
    error.value
      = (problem as { data?: { message?: string } }).data?.message
        || t('admin.packageActions.failed')
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <UDropdownMenu v-if="items.length" :items="items" :content="{ align: 'end' }">
    <UButton
      icon="i-lucide-ellipsis"
      color="neutral"
      variant="ghost"
      :aria-label="t('admin.packageActions.actionsFor', { name: organizationName })"
    />
  </UDropdownMenu>
  <UModal
    :open="!!action"
    :title="action ? t(`admin.packageActions.title.${action}`) : ''"
    :description="package?.name || organizationName"
    @update:open="(value: boolean) => { if (!value) action = null }"
  >
    <template #body>
      <UForm :state="{ days }" class="space-y-4" @submit="submit" @error="onFormError">
        <UFormField
          v-if="action === 'extend'"
          name="days"
          :label="t('admin.packageActions.days')"
          :hint="t('admin.packageActions.daysHint')"
          required
        >
          <UInputNumber v-model="days" :min="1" :max="365" class="w-full" />
        </UFormField>
        <UAlert
          v-else
          :color="action === 'cancel' ? 'error' : 'neutral'"
          variant="subtle"
          :title="action ? t(`admin.packageActions.confirm.${action}`) : ''"
        />
        <UButton
          type="submit"
          :loading="saving"
          :color="action === 'cancel' ? 'error' : 'primary'"
          :label="t('admin.packageActions.confirmButton')"
          block
        />
      </UForm>
    </template>
  </UModal>
</template>
