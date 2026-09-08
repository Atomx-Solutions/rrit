<script setup lang="ts">
import type { NuxtError } from '#app'
defineProps<{ error: NuxtError }>()
</script>
<template>
  <UApp
    ><UEmpty class="empty" style="min-height: 100dvh">
      <template #body
        ><BrandLogo /><span class="eyebrow mt-5">{{ error.statusCode }}</span>
        <h1>
          {{ error.statusCode === 404 ? 'Kjo faqe nuk u gjet.' : 'Diçka nuk shkoi siç duhet.' }}
        </h1>
        <p>
          {{
            error.statusCode === 404
              ? 'Lidhja mund të ketë ndryshuar. Kthehu te hapësira jote për të vazhduar.'
              : 'Provo sërish. Kopjet e ruajtura në pajisje mbeten të disponueshme.'
          }}
        </p>
        <UButton @click="clearError({ redirect: '/' })">Kthehu në fillim</UButton>
      </template></UEmpty
    ></UApp
  >
</template>
