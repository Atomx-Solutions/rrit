<script setup lang="ts">
import type { Post } from '~~/shared/schemas/workspace'
// Marks a post that was deleted on Facebook or Instagram after publishing:
// reposted once published again, deleted until then. Only the icon shows;
// a click names what it means.
const props = defineProps<{ post: Pick<Post, 'status' | 'networkRemovals'> }>()
const { t } = useI18n()
const count = computed(() => props.post.networkRemovals?.length ?? 0)
const reposted = computed(() => props.post.status === 'published')
const label = computed(() => t(reposted.value ? 'content.repostedBadge' : 'content.deletedBadge'))
</script>
<template>
  <UPopover v-if="count">
    <UButton
      :color="reposted ? 'info' : 'warning'"
      :icon="reposted ? 'i-lucide-repeat' : 'i-lucide-trash-2'"
      :aria-label="label"
      variant="subtle"
      size="xs"
      @click.stop
    />
    <template #content>
      <p class="px-3 py-2 text-sm">{{ label }}</p>
    </template>
  </UPopover>
</template>
