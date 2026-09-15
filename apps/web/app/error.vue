<script setup lang="ts">
import type { NuxtError } from '#app'
defineProps<{ error: NuxtError }>()
const { t } = useI18n()
</script>
<template>
  <UApp
    ><UEmpty class="empty" style="min-height: 100dvh">
      <template #body
        ><BrandLogo /><span class="eyebrow mt-5">{{ error.statusCode }}</span>
        <h1>
          {{ t(error.statusCode === 404 ? 'public.errorNotFound' : 'public.errorGeneric') }}
        </h1>
        <p>
          {{
            t(
              error.statusCode === 404
                ? 'public.errorNotFoundDescription'
                : 'public.errorGenericDescription',
            )
          }}
        </p>
        <UButton @click="clearError({ redirect: '/' })">{{ t('public.goHome') }}</UButton>
      </template></UEmpty
    ></UApp
  >
</template>
