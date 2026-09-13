<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'
import type { z } from 'zod'
import type { qualitySchema } from '~~/shared/schemas/monthly-plan'
const props = defineProps<{ post: Post; disabled?: boolean }>()
const open = ref(false)
const reviewing = ref(false)
const loadingLatest = ref(false)
const problem = ref('')
const latest = ref<z.infer<typeof qualitySchema> | null>(null)
const latestAt = ref<string | null>(null)
const reasoningItems = computed(() => {
  const reasoning = props.post.aiProvenance?.reasoning
  if (!reasoning) return []
  return [
    { icon: 'i-lucide-lightbulb', title: 'Ideja', text: reasoning.concept },
    { icon: 'i-lucide-pen-line', title: 'Teksti', text: reasoning.copy },
    { icon: 'i-lucide-layout-template', title: 'Dizajni', text: reasoning.design },
    { icon: 'i-lucide-image', title: 'Fotografia', text: reasoning.photo },
    { icon: 'i-lucide-hash', title: 'Hashtagët', text: reasoning.hashtags },
    { icon: 'i-lucide-instagram', title: 'Platforma', text: reasoning.platform },
    { icon: 'i-lucide-clock-3', title: 'Orari', text: reasoning.timing },
  ]
})
type CurrentReview = {
  contentVersion: number
  quality: z.infer<typeof qualitySchema> | null
  reviewedAt: string | null
}
async function loadLatest() {
  if (!props.post.aiProvenance || loadingLatest.value) return
  loadingLatest.value = true
  problem.value = ''
  try {
    const result = await $fetch<CurrentReview>(`/api/posts/${props.post.id}/quality`, { retry: 0 })
    if (result.contentVersion === (props.post.contentVersion || 1)) {
      latest.value = result.quality
      latestAt.value = result.reviewedAt
    }
  } catch (error) {
    problem.value =
      (error as { data?: { message?: string } }).data?.message || 'Rishikimi i ruajtur nuk u lexua.'
  } finally {
    loadingLatest.value = false
  }
}
watch(
  () => [props.post.id, props.post.contentVersion],
  () => {
    latest.value = null
    latestAt.value = null
    if (open.value) void loadLatest()
  },
)
watch(open, (visible) => {
  if (visible) void loadLatest()
})
async function review() {
  if (reviewing.value || props.disabled) return
  reviewing.value = true
  problem.value = ''
  try {
    const result = await $fetch(`/api/posts/${props.post.id}/quality`, {
      method: 'POST',
      body: { contentVersion: props.post.contentVersion || 1 },
      retry: 0,
      timeout: 195000,
    })
    if (!props.disabled && result.contentVersion === (props.post.contentVersion || 1))
      latest.value = result.quality
    latestAt.value = new Date().toISOString()
  } catch (error) {
    problem.value =
      (error as { data?: { message?: string } }).data?.message || 'Rishikimi nuk u përfundua.'
  } finally {
    reviewing.value = false
  }
}
</script>
<template>
  <template v-if="post.aiProvenance">
    <UButton
      variant="ghost"
      color="neutral"
      size="sm"
      icon="i-lucide-book-open"
      @click="open = true"
      >Pse ky postim?</UButton
    >
    <USlideover
      v-model:open="open"
      title="Ideja dhe burimet"
      description="Konteksti i ruajtur kur u krijua ky draft."
    >
      <template #body>
        <div class="space-y-6">
          <div v-if="reasoningItems.length" class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold">Pse u krijua kështu?</h3>
              <p class="mt-1 text-xs leading-5 text-muted">
                Arsyetimi i ruajtur për konceptin, tekstin, dizajnin dhe shpërndarjen.
              </p>
            </div>
            <div
              v-for="item in reasoningItems"
              :key="item.title"
              class="flex items-start gap-3 rounded-lg border border-default p-3.5"
            >
              <div
                class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted"
              >
                <UIcon :name="item.icon" class="size-4" />
              </div>
              <div>
                <h4 class="text-sm font-medium">{{ item.title }}</h4>
                <p class="mt-1 text-sm leading-6 text-muted">{{ item.text }}</p>
              </div>
            </div>
            <div v-if="post.aiProvenance.hashtags?.length" class="flex flex-wrap gap-2">
              <UBadge
                v-for="hashtag in post.aiProvenance.hashtags"
                :key="hashtag"
                color="neutral"
                variant="subtle"
              >
                {{ hashtag }}
              </UBadge>
            </div>
            <UAlert
              v-if="post.aiProvenance.revision"
              color="primary"
              variant="subtle"
              icon="i-lucide-sparkles"
              title="Ridizajnimi i fundit me AI"
              :description="post.aiProvenance.revision.instruction"
            />
          </div>
          <p v-else class="text-sm leading-7 whitespace-pre-wrap">
            {{ post.aiProvenance.rationale }}
          </p>
          <div class="space-y-3">
            <h3 class="text-sm font-semibold">Burime për kontekstin e tregut</h3>
            <ULink
              v-for="url in post.aiProvenance.sourceUrls"
              :key="url"
              :to="url"
              target="_blank"
              rel="noopener noreferrer"
              class="block text-sm text-primary underline break-words"
              >{{ url }}</ULink
            >
          </div>
          <div class="space-y-2">
            <UAlert v-if="problem" color="warning" variant="outline" :title="problem" />
            <UAlert
              v-if="latest"
              :color="latest.decision === 'BLOCK' ? 'error' : 'neutral'"
              variant="outline"
              :title="
                latest.decision === 'BLOCK'
                  ? 'Kërkon korrigjim'
                  : 'Rishikimi i versionit aktual u krye'
              "
              :description="latest.reasons.join(' ')"
            />
            <p v-if="latestAt" class="text-xs text-muted">
              Rishikim i ruajtur për versionin aktual.
            </p>
            <UButton
              v-if="['draft', 'review'].includes(post.status)"
              icon="i-lucide-scan-eye"
              color="neutral"
              variant="outline"
              :loading="reviewing || loadingLatest"
              :disabled="disabled"
              @click="review"
              >Rishiko versionin aktual me AI</UButton
            >
            <p class="text-xs text-muted">
              Përdor kuotën AI të paketës. Pas rishikimit, kryej kontrollin e përmbajtjes dhe
              miratoje vetë.
            </p>
            <h3 class="text-sm font-semibold">Rishikimi fillestar i cilësisë</h3>
            <p
              v-for="reason in post.aiProvenance.quality.reasons"
              :key="reason"
              class="text-sm text-muted"
            >
              {{ reason }}
            </p>
            <p v-if="(post.contentVersion || 1) > 1" class="text-xs text-muted">
              Përmbajtja është ndryshuar që nga ky kontroll. Rishiko versionin aktual përpara
              miratimit.
            </p>
          </div>
        </div>
      </template>
    </USlideover>
  </template>
</template>
