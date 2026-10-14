import type { Ref } from 'vue'

/** Progressive enhancement: content stays visible without JavaScript or motion. */
export function useLandingMotion(root: Ref<HTMLElement | undefined>) {
  let cleanup: (() => void) | undefined
  onMounted(() => {
    if (!root.value) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const active = new Set<Animation>()
    const seen = new WeakSet<Element>()
    const selector = [
      '.landing-hero-copy > *',
      '.landing-process-inner',
      '.landing-feature-copy',
      '.landing-section-heading',
      '.landing-plan-card',
      '.landing-faq-layout',
      '.landing-final',
    ].join(',')
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          if (seen.has(entry.target)) continue
          seen.add(entry.target)
          if (media.matches) continue
          const animation = entry.target.animate(
            [
              { opacity: 0.65, transform: 'perspective(1000px) translateY(22px) rotateX(3deg)' },
              { opacity: 1, transform: 'perspective(1000px) translateY(0) rotateX(0)' },
            ],
            { duration: 800, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', id: 'rrit-reveal' },
          )
          active.add(animation)
          animation.onfinish = () => active.delete(animation)
          animation.oncancel = () => active.delete(animation)
        }
      },
      { threshold: 0.08 },
    )
    const observe = () => {
      root.value?.querySelectorAll(selector).forEach((element) => {
        if (!seen.has(element)) observer.observe(element)
      })
    }
    observe()
    // Plan cards can arrive after mount or after retrying the catalog request.
    // Re-querying the whole subtree per mutation record was wasted work, so a
    // burst of mutations collapses into a single pass.
    let queued = false
    const queueObserve = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        observe()
      })
    }
    const mutations = new MutationObserver(queueObserve)
    mutations.observe(root.value, { childList: true, subtree: true })
    const stop = () => {
      if (media.matches) {
        for (const animation of active) animation.cancel()
        active.clear()
      }
    }
    media.addEventListener('change', stop)
    cleanup = () => {
      observer.disconnect()
      mutations.disconnect()
      media.removeEventListener('change', stop)
      for (const animation of active) animation.cancel()
      active.clear()
    }
  })
  onBeforeUnmount(() => cleanup?.())
}
