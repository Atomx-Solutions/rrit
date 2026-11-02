/**
 * A <Transition :css="false"> hook that slides an element open or shut to the
 * height it shows. An element whose own max-height caps it ends the movement
 * there rather than at its full content.
 */
export function slide(element: Element, opening: boolean, done: () => void) {
  const box = element as HTMLElement
  const shown = Math.min(box.scrollHeight, Number.parseFloat(getComputedStyle(box).maxHeight) || Infinity)
  const [from, to] = opening ? [0, shown] : [shown, 0]
  box.style.overflow = 'hidden'
  box.style.height = `${from}px`
  box.style.opacity = opening ? '0' : '1'
  requestAnimationFrame(() => {
    box.style.transition = 'height 200ms ease-out, opacity 200ms ease-out'
    box.style.height = `${to}px`
    box.style.opacity = opening ? '1' : '0'
  })
  box.addEventListener('transitionend', function finish(event) {
    if (event.target !== box || event.propertyName !== 'height') return
    box.removeEventListener('transitionend', finish)
    for (const property of ['height', 'opacity', 'overflow', 'transition']) box.style.removeProperty(property)
    done()
  })
}
