import type { Post } from '~~/shared/schemas/workspace'

// How often a video still being made is read again. Shared by the post editor
// and the post lists, so both see a finished video at the same moment.
export const videoFollowMs = 10000

// A video is on its way from the moment its brief is ready until the render
// has finished or failed; the thumbnails show it the same way.
export function videoPending(video: Post['video'] | undefined) {
  return video?.status === 'brief_ready' || video?.status === 'rendering'
}

/**
 * Keeps a list of posts current while any of their videos is still being made,
 * so a finished or failed video shows without the page being reloaded. It
 * reads nothing while no video is on its way or the tab is in the background,
 * and stops once the page is left.
 */
export function useFollowVideos() {
  const { data, initLive, syncing, conflict } = useWorkspace()
  const pending = computed(() => data.value.posts.some((post) => videoPending(post.video)))
  let timer: ReturnType<typeof setInterval> | undefined
  let reading = false
  function stop() {
    clearInterval(timer)
    timer = undefined
  }
  function start() {
    if (timer) return
    timer = setInterval(async () => {
      if (reading || document.hidden || syncing.value || conflict.value) return
      reading = true
      try {
        await initLive()
      } catch {
        /* The last loaded posts stay visible; the next read tries again. */
      } finally {
        reading = false
      }
    }, videoFollowMs)
  }
  onMounted(() => {
    watch(pending, (onItsWay) => (onItsWay ? start() : stop()), { immediate: true })
  })
  onBeforeUnmount(stop)
}
