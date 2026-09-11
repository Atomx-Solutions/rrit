<script setup lang="ts">
import { organizationFormMessage, slugFromOrganizationName } from '~/utils/organization-ui'

const emit = defineEmits<{ created: [] }>()
const { createOrganization, loading } = useOrganizationContext()
const form = reactive({ name: '', slug: '' })
const slugTouched = ref(false)
const error = ref('')

watch(
  () => form.name,
  (name) => {
    if (!slugTouched.value) form.slug = slugFromOrganizationName(name)
  },
)

async function submit() {
  error.value = organizationFormMessage(form) || ''
  if (error.value) return
  try {
    await createOrganization({ name: form.name, slug: form.slug })
    emit('created')
  } catch (problem) {
    error.value =
      (problem as { data?: { message?: string } }).data?.message ||
      'Organizata nuk u krijua. Provo sërish.'
  }
}
</script>

<template>
  <UCard data-testid="organization-empty-state">
    <div class="space-y-2">
      <UIcon name="i-lucide-building-2" class="size-8 text-primary" aria-hidden="true" />
      <h1 class="text-2xl font-semibold">Krijo organizatën e parë</h1>
      <p class="text-sm text-muted">
        Organizata është hapësira jote kryesore. Mund ta ndryshosh më vonë nga switcher-i.
      </p>
    </div>
    <UForm :state="form" class="mt-6 space-y-4" @submit="submit">
      <UFormField label="Emri i organizatës" name="name" required>
        <UInput
          v-model="form.name"
          data-testid="organization-name"
          autocomplete="organization"
          minlength="2"
          maxlength="120"
          required
          class="w-full"
          placeholder="P.sh. Studio Aksesueshme"
        />
      </UFormField>
      <UFormField label="Slug" name="slug" required>
        <UInput
          v-model="form.slug"
          data-testid="organization-slug"
          minlength="2"
          maxlength="80"
          pattern="[a-z0-9][a-z0-9-]*"
          required
          class="w-full"
          @update:model-value="slugTouched = true"
        />
      </UFormField>
      <UAlert v-if="error" color="error" variant="outline" :title="error" role="alert" />
      <UButton
        type="submit"
        :loading="loading"
        data-testid="organization-create"
        label="Krijo organizatën"
      />
    </UForm>
  </UCard>
</template>
