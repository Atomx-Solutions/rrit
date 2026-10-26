import type { Ref } from 'vue'

/**
 * Keeps the selected thumbnail in the middle of a horizontally scrolling
 * strip, so the ones either side of it stay in view as the viewer steps. Only
 * the strip scrolls; the page and dialog around it do not move.
 */
export function useCenteredStrip(strip: Ref<HTMLElement | null>, index: Ref<number>, open: Ref<boolean>) {
  function centre(behavior: ScrollBehavior) {
    const container = strip.value
    const item = container?.children[index.value] as HTMLElement | undefined
    if (!container || !item) return
    const offset = item.getBoundingClientRect().left - container.getBoundingClientRect().left
    container.scrollTo({
      left: container.scrollLeft + offset - (container.clientWidth - item.offsetWidth) / 2,
      behavior,
    })
  }
  // Opening jumps straight to the selection, once the strip is on the page;
  // stepping glides to it.
  watch([open, strip], ([isOpen, element]) => {
    if (isOpen && element) nextTick(() => centre('instant'))
  })
  watch(index, () => {
    if (open.value) nextTick(() => centre('smooth'))
  })
}
