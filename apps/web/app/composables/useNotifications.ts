import { lowCreditAction } from '~/utils/low-credit'

export type NotificationItem = {
  key: string
  icon: string
  tone: 'warning' | 'error' | 'primary' | 'neutral'
  title: string
  description: string
  to: string
  request?: 'package' | 'credits'
  // What makes this notice new: once it changes (more posts waiting, another
  // package ending) a notice read or removed earlier shows again.
  signature: string
  read: boolean
}

type Marks = { read: Record<string, string>; removed: Record<string, string> }

/**
 * Everything that needs the business's attention, in one list: the bell shows
 * how many there are and its panel lists them. Package, credit and trial
 * reminders live here instead of as banners on every page.
 */
export function useNotifications() {
  const { t } = useI18n()
  const { data, base } = useWorkspace()
  const { data: usage } = useHeaderUsage()
  const { data: meta } = useFetch('/api/meta/status', { key: 'meta-status', lazy: true, server: false })

  const all = computed(() => {
    const list: Omit<NotificationItem, 'read'>[] = []
    const snapshot = usage.value
    if (snapshot?.packageExpiry)
      list.push({
        key: 'package-expiry',
        icon: 'i-lucide-circle-alert',
        tone: 'error',
        title: t('packageExpiry.title'),
        description: t('packageExpiry.description', { package: snapshot.packageExpiry.packageName }),
        to: `${base.value}/billing`,
        request: 'package',
        signature: snapshot.packageExpiry.packageName,
      })
    const credits = snapshot?.credits?.remaining
    const threshold = snapshot?.lowCredit?.threshold
    if (credits !== undefined && threshold !== undefined && Number(credits ?? 0) < threshold) {
      const action = lowCreditAction(snapshot?.lowCredit?.hasActivePackage)
      list.push({
        key: 'low-credit',
        icon: 'i-lucide-coins',
        tone: 'warning',
        title: t('lowCredit.title', { credits: Number(credits ?? 0) }),
        description: action === 'request-package'
          ? t('lowCredit.requestPackageDescription')
          : t('lowCredit.requestCreditsDescription'),
        to: `${base.value}/billing`,
        request: action === 'request-package' ? 'package' : 'credits',
        signature: action,
      })
    }
    const trial = snapshot?.trial
    if (trial && !trial.paid && trial.state === 'active')
      list.push({
        key: 'trial',
        icon: 'i-lucide-clock-3',
        tone: 'neutral',
        title: t('trial.free', { remaining: trialRemaining(trial.secondsRemaining) }),
        description: t('trial.activeDescription'),
        to: `${base.value}/billing`,
        signature: trial.expiresAt || 'trial',
      })
    // Counted the way the posts list files them: a post whose video failed is
    // listed with the failed posts, not as awaiting approval.
    const awaiting = data.value.posts.filter((post) => post.status === 'review' && post.video?.status !== 'failed').length
    if (awaiting)
      list.push({
        key: 'approvals',
        icon: 'i-lucide-file-check',
        tone: 'primary',
        title: t('nav.approvalPosts'),
        description: t('nav.approvalPostsDescription', { count: awaiting }),
        to: `${base.value}/content?status=review`,
        signature: String(awaiting),
      })
    if (meta.value && meta.value.connection?.status !== 'connected')
      list.push({
        key: 'connections',
        icon: 'i-lucide-link',
        tone: 'neutral',
        title: t('nav.meta'),
        description: t('nav.metaDescription'),
        to: `${base.value}/social-posts`,
        signature: 'not-connected',
      })
    return list
  })

  function trialRemaining(seconds: number | undefined) {
    const hours = (seconds || 0) / 3600
    return hours >= 24
      ? `${Math.floor(hours / 24)} ${t('trial.days')}`
      : `${Math.max(1, Math.floor(hours))} ${t('trial.hours')}`
  }

  // Read and removed notices are remembered per business in this browser;
  // they are the viewer's own housekeeping, not shared with the team.
  const storageKey = computed(() => `rrit:notifications:${base.value}`)
  const marks = useState<Marks>('notification-marks', () => ({ read: {}, removed: {} }))
  const loaded = useState('notification-marks-loaded', () => '')
  if (import.meta.client && loaded.value !== storageKey.value) {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey.value) || 'null') as Marks | null
      marks.value = { read: stored?.read || {}, removed: stored?.removed || {} }
    } catch {
      marks.value = { read: {}, removed: {} }
    }
    loaded.value = storageKey.value
  }
  function persist() {
    try {
      localStorage.setItem(storageKey.value, JSON.stringify(marks.value))
    } catch {
      // Without storage the marks still hold until the page reloads.
    }
  }
  const items = computed<NotificationItem[]>(() =>
    all.value
      .filter((item) => marks.value.removed[item.key] !== item.signature)
      .map((item) => ({ ...item, read: marks.value.read[item.key] === item.signature })),
  )
  const unread = computed(() => items.value.filter((item) => !item.read).length)
  function markRead(item: NotificationItem) {
    marks.value.read[item.key] = item.signature
    persist()
  }
  function markUnread(item: NotificationItem) {
    marks.value.read = Object.fromEntries(Object.entries(marks.value.read).filter(([key]) => key !== item.key))
    persist()
  }
  function toggleRead(item: NotificationItem) {
    if (item.read) markUnread(item)
    else markRead(item)
  }
  function markAllRead() {
    for (const item of items.value) marks.value.read[item.key] = item.signature
    persist()
  }
  function remove(item: NotificationItem) {
    marks.value.removed[item.key] = item.signature
    persist()
  }
  function removeAll() {
    for (const item of items.value) marks.value.removed[item.key] = item.signature
    persist()
  }

  return { items, unread, markRead, toggleRead, markAllRead, remove, removeAll }
}
