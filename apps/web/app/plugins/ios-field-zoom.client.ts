// iOS zooms the page when a form field with type under 16px gets focus. On
// iOS a maximum scale stops that zoom while pinch-zoom stays available, so
// form fields can follow the device's type size there like everything else.
// Other platforms keep the plain viewport, where the same setting would
// block pinch-zoom.
export default defineNuxtPlugin(() => {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!ios) return
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (viewport && !viewport.content.includes('maximum-scale'))
    viewport.content = `${viewport.content}, maximum-scale=1`
})
