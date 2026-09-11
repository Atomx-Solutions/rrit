<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { organizations, activeOrganization, ready, loadOrganizations, selectOrganization } =
  useOrganizationContext()
const error = ref('')

onMounted(async () => {
  try {
    await loadOrganizations()
  } catch (problem) {
    const status = (problem as { statusCode?: number }).statusCode
    if (status === 401) {
      await navigateTo('/login')
      return
    }
    error.value = 'Organizatat nuk u ngarkuan. Provo sërish.'
  }
})

async function created() {
  await loadOrganizations()
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <p class="text-sm text-muted">Konteksti i llogarisë</p>
      <h1 class="mt-2 text-3xl font-semibold">Organizatat</h1>
      <p class="mt-2 text-sm text-muted">Zgjidh ose krijo organizatën ku dëshiron të punosh.</p>
    </div>
    <UAlert v-if="error" color="error" variant="outline" :title="error" role="alert" />
    <USkeleton v-if="!ready" class="h-48 w-full" data-testid="organization-page-loading" />
    <OrganizationEmptyState v-else-if="!organizations.length" @created="created" />
    <UCard v-else data-testid="organization-list">
      <div class="space-y-3">
        <UButton
          v-for="organization in organizations"
          :key="organization.id"
          color="neutral"
          variant="outline"
          class="flex w-full items-center justify-between p-4 text-left"
          :data-testid="`organization-option-${organization.id}`"
          @click="selectOrganization(organization.id)"
        >
          <span>
            <span class="block font-medium">{{ organization.name }}</span>
            <span class="block text-sm text-muted">{{ organization.slug }} · {{ organization.role }}</span>
          </span>
          <template v-if="organization.id === activeOrganization?.id" #trailing>
            <UBadge color="primary">Aktive</UBadge>
          </template>
        </UButton>
      </div>
      <div class="mt-6 border-t border-default pt-6">
        <OrganizationEmptyState @created="created" />
      </div>
    </UCard>
  </div>
</template>
