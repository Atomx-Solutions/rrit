export default defineNuxtRouteMiddleware((to) => {
  const match = to.path.match(
    /^\/app\/([^/]+)\/([^/]+)\/(campaigns|strategy|analytics|team|integrations)(?:\/|$)/,
  )
  if (!match) return
  const target = match[3] === 'integrations' ? 'social-posts' : 'content'
  return navigateTo(`/app/${match[1]}/${match[2]}/${target}`, { replace: true })
})
