<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Post } from '~~/shared/schemas/workspace'
import { formatDate } from '~~/shared/utils/format'
defineProps<{ posts: Post[] }>()
const { base, data } = useWorkspace()
const columns: TableColumn<Post>[] = [
  { accessorKey: 'title', header: 'Postimi' },
  { accessorKey: 'channel', header: 'Rrjeti' },
  { accessorKey: 'status', header: 'Gjendja' },
  { accessorKey: 'scheduledAt', header: 'Orari' },
  { id: 'actions', header: '' },
]
</script>
<template>
  <div class="md:hidden divide-y divide-default">
    <ULink
      v-for="post in posts"
      :key="post.id"
      :to="`${base}/content/${post.id}`"
      class="flex gap-3 p-4 active:bg-elevated/50"
    >
      <MediaImage
        :src="post.image"
        alt=""
        width="56"
        height="64"
        loading="lazy"
        class="w-14 h-16 shrink-0 object-cover rounded-md"
      />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-medium text-highlighted line-clamp-2">{{ post.title }}</h3>
        <div class="flex flex-wrap items-center gap-2 mt-2">
          <StatusBadge :status="post.status" /><span class="text-xs text-muted">{{
            post.channel
          }}</span>
        </div>
        <p v-if="post.scheduledAt" class="text-xs text-muted mt-2">
          {{ formatDate(post.scheduledAt, data.preferences.timezone) }}
          <span v-if="post.status === 'scheduled'" class="block mt-1">{{
            post.publicationMode === 'automatic' ? 'Publikim automatik' : 'Vetëm në kalendar'
          }}</span>
        </p>
      </div>
      <UIcon name="i-lucide-chevron-right" class="size-4 text-muted shrink-0 self-center" />
    </ULink>
  </div>
  <UTable
    class="hidden md:block"
    :data="posts"
    :columns="columns"
    empty="Nuk ka postime për këtë përzgjedhje."
    :ui="{
      root: 'w-full',
      base: 'w-full table-fixed border-separate border-spacing-0',
      thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
      th: 'py-3 px-4 text-xs font-medium first:w-[42%] last:w-16',
      td: 'px-4 py-4 border-b border-default',
      tbody: '[&>tr]:last:[&>td]:border-b-0',
      separator: 'h-0',
    }"
  >
    <template #title-cell="{ row }">
      <ULink
        :to="`${base}/content/${row.original.id}`"
        class="flex items-center gap-3 min-w-0 group"
      >
        <MediaImage
          :src="row.original.image"
          alt=""
          width="44"
          height="44"
          loading="lazy"
          class="size-11 shrink-0 rounded-md object-cover"
        />
        <div class="min-w-0">
          <h3 class="text-sm font-medium text-highlighted truncate group-hover:text-primary">
            {{ row.original.title }}
          </h3>
          <p class="text-xs text-muted truncate mt-1">{{ row.original.caption }}</p>
        </div>
      </ULink>
    </template>
    <template #channel-cell="{ row }">
      <span class="inline-flex items-center gap-2 text-sm"
        ><UIcon
          :name="row.original.channel === 'Instagram' ? 'i-lucide-instagram' : 'i-lucide-facebook'"
          class="size-4 text-muted"
        />{{ row.original.channel }}</span
      >
    </template>
    <template #status-cell="{ row }"><StatusBadge :status="row.original.status" /></template>
    <template #scheduledAt-cell="{ row }"
      ><span class="text-xs text-muted">{{
        row.original.scheduledAt
          ? formatDate(row.original.scheduledAt, data.preferences.timezone)
          : 'Pa orar'
      }}</span
      ><span v-if="row.original.status === 'scheduled'" class="block text-xs text-muted mt-1">{{
        row.original.publicationMode === 'automatic' ? 'Publikim automatik' : 'Vetëm në kalendar'
      }}</span></template
    >
    <template #actions-cell="{ row }"
      ><UButton
        :to="`${base}/content/${row.original.id}`"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-up-right"
        :aria-label="`Hap postimin: ${row.original.title}`"
    /></template>
  </UTable>
</template>
