type ContentActivityPost = {
  createdAt?: string
  proposedAt?: string
  publishedAt?: string
  scheduledAt: string | null
}

/** A post belongs to the day it entered the workspace. */
export function contentActivityDate(post: ContentActivityPost) {
  return post.createdAt || post.proposedAt || post.publishedAt || post.scheduledAt
}
