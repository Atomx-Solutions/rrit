import type { Post } from '../schemas/workspace'

// A scheduled post must leave the calendar first, and a published one stays as
// the record of what went out; every other post may be deleted for good.
const keptStatuses: readonly Post['status'][] = ['scheduled', 'published']

export function canDeletePost(post: Pick<Post, 'status'>) {
  return !keptStatuses.includes(post.status)
}

// A workspace holds at most this many posts (see the workspace save), so one
// request can always carry a whole selection.
export const maxPostsPerDelete = 1000
