<script setup lang="ts">
defineProps<{ kind: 'privacy' | 'terms' | 'security' }>()
const { data: site, error: siteError } = await useFetch('/api/site')
const { t } = useI18n()
const { showError } = useFormFeedback()
watch(siteError, (value) => {
  if (value) showError(t('policy.operatorPendingDescription'), 'warning')
}, { immediate: true })
const titles = {
  privacy: 'policy.privacyTitle',
  terms: 'policy.termsTitle',
  security: 'policy.securityTitle',
}
</script>
<template>
  <section class="public-section max-w-3xl">
    <h1 class="mb-8">{{ t(titles[kind]) }}</h1>
    <div class="space-y-6 text-sm leading-7">
      <template v-if="kind === 'privacy'"
        ><h2>{{ t('policy.dataTitle') }}</h2><p>{{ t('policy.dataDescription') }}</p>
        <h2>{{ t('policy.metaTitle') }}</h2><p>{{ t('policy.metaDescription') }}</p>
        <h2>{{ t('policy.trialTitle') }}</h2><p>{{ t('policy.trialDescription') }}</p>
        <h2>{{ t('policy.photosTitle') }}</h2><p>{{ t('policy.photosDescription') }}</p>
        <h2>{{ t('policy.exportTitle') }}</h2><p>{{ t('policy.exportDescription') }}</p></template
      >
      <template v-else-if="kind === 'terms'"
        ><h2>{{ t('policy.accountTitle') }}</h2>
        <p>
          {{ t('policy.accountDescription') }}
        </p>
        <h2>{{ t('policy.publishingTitle') }}</h2>
        <p>
          {{ t('policy.publishingDescription') }}
        </p>
        <h2>{{ t('policy.freePeriodTitle') }}</h2>
        <p>
          {{ t('policy.freePeriodDescription') }}
        </p></template
      >
      <template v-else
        ><h2>{{ t('legacy.loginRulesTitle') }}</h2>
        <p>
          {{ t('legacy.loginRules') }}
        </p>
        <h2>{{ t('legacy.accessRulesTitle') }}</h2>
        <p>
          {{ t('legacy.accessRules') }}
        </p>
        <h2>{{ t('legacy.publicationStatusTitle') }}</h2>
        <p>
          {{ t('legacy.publicationStatus') }}
        </p></template
      >
      <USeparator />
      <p v-if="site?.operator">{{ t('policy.operator') }}: {{ site.operator }}</p>
      <p v-if="site?.privacyEmail">
        {{ t('policy.privacyContact') }}:
        <ULink :to="'mailto:' + site.privacyEmail" class="text-primary">{{
          site.privacyEmail
        }}</ULink>
      </p>
      <UAlert
        v-if="!site?.operator || !site?.privacyEmail"
        color="neutral"
        variant="outline"
        :title="t('policy.operatorPendingTitle')"
        :description="t('policy.operatorPendingDescription')"
      /><UButton to="/help" color="neutral" variant="link">{{ t('policy.usageGuidance') }}</UButton>
    </div>
  </section>
</template>
