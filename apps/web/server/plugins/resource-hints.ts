// Nuxt announces every chunk a page could ever need as a high-priority
// modulepreload, and every lazy chunk as a prefetch. On a phone connection
// those downloads compete with the stylesheet and font the first paint waits
// for, so the HTML drops them; the entry <script> stays, and the browser
// finds the remaining chunks through its imports.
const preload = /<link rel="(?:modulepreload|prefetch)"[^>]*>/g

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:html', (html) => {
    html.head = html.head.map((part) => part.replace(preload, ''))
  })
})
