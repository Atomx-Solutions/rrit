<script setup lang="ts">
import { z } from 'zod'
import { authClient } from '~/utils/auth-client'
const toast = useToast()
const busy = ref(false)
const error = ref('')
const form = reactive({ currentPassword: '', newPassword: '', confirm: '' })
const schema = z
  .object({
    currentPassword: z.string().min(1, 'Vendos fjalëkalimin aktual.'),
    newPassword: z.string().min(12, 'Përdor të paktën 12 karaktere.').max(128),
    confirm: z.string(),
  })
  .refine((value) => value.newPassword === value.confirm, {
    message: 'Fjalëkalimet nuk përputhen.',
    path: ['confirm'],
  })
const {
  data: sessions,
  refresh,
  status,
} = await useAsyncData('account-sessions', async () => {
  const result = await authClient.listSessions()
  if (result.error) throw new Error('Sesioni nuk mund të lexohet.')
  return result.data || []
})
const items = computed(() => sessions.value || [])
const { page, pageSize, total, paginated } = usePagination(items, 5)
async function changePassword() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await authClient.changePassword({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
      revokeOtherSessions: true,
    })
    if (result.error)
      error.value = 'Fjalëkalimi nuk u ndryshua. Kontrollo fjalëkalimin aktual dhe provo sërish.'
    else {
      Object.assign(form, { currentPassword: '', newPassword: '', confirm: '' })
      toast.add({ title: 'Fjalëkalimi u ndryshua. Sesionet e tjera u mbyllën.', color: 'success' })
      await refresh()
    }
  } catch {
    error.value = 'Lidhja dështoi. Provo sërish.'
  } finally {
    busy.value = false
  }
}
async function revokeOthers() {
  busy.value = true
  try {
    const result = await authClient.revokeOtherSessions()
    if (result.error) error.value = 'Sesionet nuk u mbyllën. Provo sërish.'
    else {
      await refresh()
      toast.add({ title: 'U mbyllën sesionet në pajisjet e tjera', color: 'success' })
    }
  } catch {
    error.value = 'Lidhja dështoi. Provo sërish.'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-base font-semibold">Siguria e llogarisë</h2>
      <p class="text-sm text-muted mt-2">
        Përditëso fjalëkalimin dhe kontrollo pajisjet ku ke hyrë.
      </p>
    </div>
    <UAlert v-if="error" color="error" variant="outline" :title="error" />
    <UForm :state="form" :schema="schema" class="space-y-5" @submit="changePassword">
      <UFormField name="currentPassword" label="Fjalëkalimi aktual" required
        ><UInput
          v-model="form.currentPassword"
          type="password"
          autocomplete="current-password"
          class="w-full"
          :disabled="busy"
      /></UFormField>
      <UFormField name="newPassword" label="Fjalëkalimi i ri" required
        ><UInput
          v-model="form.newPassword"
          type="password"
          autocomplete="new-password"
          class="w-full"
          :disabled="busy"
          maxlength="128"
      /></UFormField>
      <UFormField name="confirm" label="Përsërit fjalëkalimin e ri" required
        ><UInput
          v-model="form.confirm"
          type="password"
          autocomplete="new-password"
          class="w-full"
          :disabled="busy"
      /></UFormField>
      <UButton type="submit" variant="outline" :loading="busy" icon="i-lucide-key-round"
        >Ndrysho fjalëkalimin</UButton
      >
    </UForm>
    <USeparator />
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-semibold">Pajisjet ku ke hyrë</h2>
      <UButton variant="outline" color="neutral" :loading="busy" @click="revokeOthers"
        >Mbyll sesionet e tjera</UButton
      >
    </div>
    <USkeleton v-if="status === 'pending'" class="h-20 w-full" />
    <UAlert
      v-else-if="status === 'error'"
      color="warning"
      variant="outline"
      title="Sesionet nuk mund të ngarkohen"
      :actions="[{ label: 'Provo sërish', onClick: () => refresh() }]"
    />
    <UCard v-else :ui="{ body: 'p-0 sm:p-0' }"
      ><ul class="divide-y divide-default">
        <li v-for="session in paginated" :key="session.id" class="p-4 flex gap-3">
          <UIcon name="i-lucide-monitor-smartphone" class="size-5 shrink-0 text-muted mt-0.5" />
          <div class="min-w-0">
            <p class="text-sm break-words line-clamp-2">
              {{ session.userAgent || 'Pajisje e panjohur' }}
            </p>
            <p class="text-xs text-muted mt-2">
              Hyrja:
              {{
                new Intl.DateTimeFormat('sq-AL', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(session.createdAt))
              }}
            </p>
          </div>
        </li>
      </ul>
      <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="total"
    /></UCard>
  </div>
</template>
