<script setup lang="ts">
const open = ref(false)
const { data, status, error, refresh } = await useFetch('/api/business/brain-history', {
  immediate: false,
  server: false,
})
async function show() {
  open.value = true
  await refresh()
}
</script>

<template>
  <UButton color="neutral" variant="ghost" icon="i-lucide-history" @click="show"
    >Historiku i profilit</UButton
  >
  <USlideover
    v-model:open="open"
    title="Historiku i biznesit"
    description="20 versionet e fundit të ruajtura. Konfirmimi i fakteve bëhet nga biznesi, jo nga AI."
  >
    <template #body>
      <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
        Po ngarkohet historiku…
      </p>
      <UAlert
        v-else-if="error"
        color="warning"
        variant="outline"
        title="Historiku nuk u ngarkua."
      />
      <p v-else-if="!data?.versions.length" class="text-sm text-muted">
        Historiku shfaqet pas ruajtjes së profilit.
      </p>
      <UAccordion
        v-else
        :items="
          data.versions.map((entry) => ({
            label: `Versioni ${entry.version}`,
            value: String(entry.version),
            entry,
          }))
        "
      >
        <template #body="{ item }">
          <div class="space-y-3 pb-4 text-sm">
            <p class="text-xs text-muted">
              {{ new Date(item.entry.createdAt).toLocaleString('sq-AL') }}
            </p>
            <p class="font-medium">{{ item.entry.brand.name }}</p>
            <p class="text-muted">{{ item.entry.brand.voice }}</p>
            <div
              v-for="fact in item.entry.brand.facts"
              :key="fact.id"
              class="rounded-lg border border-default p-3 space-y-1"
            >
              <p>{{ fact.text }}</p>
              <p class="text-xs text-muted">Burimi: {{ fact.source }}</p>
              <p class="text-xs text-muted">
                {{ fact.verified ? 'Konfirmuar nga biznesi' : 'Pa konfirmim'
                }}<span v-if="fact.validFrom || fact.validUntil">
                  · {{ fact.validFrom || '—' }} → {{ fact.validUntil || '—' }}</span
                >
              </p>
            </div>
            <p v-for="rule in item.entry.brand.guardrails || []" :key="rule" class="text-muted">
              {{ rule }}
            </p>
          </div>
        </template>
      </UAccordion>
    </template>
  </USlideover>
</template>
