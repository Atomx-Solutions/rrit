import { checkPublishedPost, recentPublishedPostIds } from '../../utils/published-post-presence'

// Checks the business's recently published posts, so a post deleted on
// Facebook or Instagram stops showing as published without being opened.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const removed: string[] = []
  for (const id of await recentPublishedPostIds(user.id))
    if (await checkPublishedPost(user.id, id)) removed.push(id)
  return { removed }
})
