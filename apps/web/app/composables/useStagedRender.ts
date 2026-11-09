/**
 * Mounts a page in stages, one per browser task, instead of all at once.
 * Rendering a whole dashboard in a single task blocked a slow phone's main
 * thread long enough to dominate its Total Blocking Time; each stage is now
 * a task of its own, with a frame painted in between.
 *
 * Returns the number of stages shown so far; a section renders once the
 * count reaches its position. Everything above the first stage shows at once.
 */
export function useStagedRender(stages: number) {
  const shown = ref(0)
  let timer: ReturnType<typeof setTimeout> | undefined
  function next() {
    if (shown.value >= stages) return
    // A frame first, so the work already shown is painted before the next
    // stage starts; then a fresh task, so the two never run as one.
    requestAnimationFrame(() => {
      timer = setTimeout(() => {
        shown.value++
        next()
      })
    })
  }
  onMounted(next)
  onBeforeUnmount(() => clearTimeout(timer))
  return shown
}
