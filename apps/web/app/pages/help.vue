<script setup lang="ts">
definePageMeta({ layout: 'public' })
const { t } = useI18n()
useSeoMeta({ title: () => `${t('help.title')} · Rrit` })
const { data: capabilities } = await useFetch('/api/capabilities')
const search = ref('')
const topicKeys = Array.from({ length: 9 }, (_, index) => index + 1)
const topics = computed(() => topicKeys.map((index) => ({
  label: t(`help.topic${index}Label`),
  content: t(`help.topic${index}Content`, index === 1
    ? {
        verification: capabilities.value?.emailVerificationRequired
          ? t('help.verifyEmail')
          : t('help.then'),
      }
    : {}),
})))
const filtered = computed(() =>
  topics.value.filter((t) =>
    (t.label + ' ' + t.content).toLowerCase().includes(search.value.trim().toLowerCase()),
  ),
)
const { page, pageSize, total, paginated } = usePagination(filtered)
watch(search, () => {
  page.value = 1
})
</script>
<template>
  <section class="public-section max-w-3xl">
    <p class="eyebrow">{{ t('help.eyebrow') }}</p>
    <h1 class="my-5">{{ t('help.title') }}</h1>
    <UInput
      v-model="search"
      icon="i-lucide-search"
      :aria-label="t('help.searchLabel')"
      :placeholder="t('help.searchPlaceholder')"
      class="w-full mb-6"
    /><UAccordion :items="paginated" /><ListPagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
    /><UButton to="/app" variant="outline" class="mt-6">{{ t('help.openWorkspace') }}</UButton>
  </section>
</template>
