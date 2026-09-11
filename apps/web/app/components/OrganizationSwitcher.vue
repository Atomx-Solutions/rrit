<script setup lang="ts">
const {
  organizations,
  activeOrganization,
  ready,
  loading,
  loadOrganizations,
  selectOrganization,
} = useOrganizationContext()

onMounted(async () => {
  if (!ready.value) {
    try {
      await loadOrganizations()
    } catch {
      // The page that owns the context reports API failures.
    }
  }
})

const menuItems = computed(() => [
  organizations.value.map((organization) => ({
    label: organization.name,
    icon: organization.id === activeOrganization.value?.id ? 'i-lucide-check' : undefined,
    onSelect: () => selectOrganization(organization.id),
  })),
  [{ label: 'Menaxho organizatat', icon: 'i-lucide-settings-2', to: '/organizations' }],
])
</script>

<template>
  <USkeleton v-if="loading && !ready" class="h-9 w-40" data-testid="organization-loading" />
  <UButton
    v-else-if="!organizations.length"
    to="/organizations"
    color="primary"
    variant="soft"
    icon="i-lucide-plus"
    label="Krijo organizatë"
    data-testid="organization-empty-link"
  />
  <UDropdownMenu
    v-else
    :items="menuItems"
    :content="{ align: 'start', collisionPadding: 12 }"
    :ui="{ content: 'w-(--reka-dropdown-menu-trigger-width) min-w-64' }"
  >
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-building-2"
      :label="activeOrganization?.name || 'Zgjidh organizatë'"
      trailing-icon="i-lucide-chevrons-up-down"
      aria-label="Organizata aktive"
      data-testid="organization-switcher"
      class="max-w-64 min-w-0"
      :ui="{ label: 'truncate' }"
    />
  </UDropdownMenu>
</template>
