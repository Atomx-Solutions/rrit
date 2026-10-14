import type { Post } from '~~/shared/schemas/workspace'

// One icon per channel a post can reach, so every list names the same
// platform the same way.
const channelIcons: Record<Post['channel'], string> = {
  Instagram: 'i-lucide-instagram',
  Facebook: 'i-lucide-facebook',
  TikTok: 'i-simple-icons-tiktok',
}

export function channelIcon(channel: Post['channel']) {
  return channelIcons[channel]
}
