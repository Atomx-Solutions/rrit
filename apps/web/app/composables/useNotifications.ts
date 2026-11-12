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

type Marks = { read: Record<string, string>; snoozedUntil: Record<string, number> }
const REMINDER_SNOOZE_MS = 24 * 60 * 60 * 1000
const EMPTY_MARKS: Marks = { read: {}, snoozedUntil: {} }

/**
 * Everything that needs the business's attention, in one list: the bell shows
 * how many there are and its panel lists them. Package, credit and trial
 * reminders live here instead of as banners on every page.
 */
export function useNotifications() {
  const { t, locale } = useI18n()
  const { data, base } = useWorkspace()
  const { data: usage } = useHeaderUsage()
  const { data: meta } = useFetch('/api/meta/status', { key: 'meta-status', lazy: true, server: false })
  const { data: instagram } = useFetch('/api/instagram/status', { key: 'instagram-status', lazy: true, server: false })
  const { data: tiktok } = useFetch('/api/tiktok/status', { key: 'tiktok-status', lazy: true, server: false })
  // Same request and key as the billing page, so paying or declining there
  // clears the offer here as well.
  const { data: billing } = useFetch('/api/billing/subscription', { lazy: true, key: 'billing-subscription-currency-v2' })

  const all = computed(() => {
    const list: Omit<NotificationItem, 'read'>[] = []
    const snapshot = usage.value
    const offer = billing.value?.packageProposal
    // The billing page hides an offer of only videos or credits until a package
    // runs, because it cannot be bought before then; the notice does the same.
    if (offer && (offer.postsIncluded > 0 || snapshot?.lowCredit?.hasActivePackage))
      list.push({
        key: 'package-offer',
        icon: 'i-lucide-handshake',
        tone: 'primary',
        title: t('billing.packageProposalTitle'),
        description: `${offer.name} · ${new Intl.NumberFormat(locale.value, {
          style: 'currency',
          currency: billing.value!.currency,
        }).format(offer.price)}`,
        to: `${base.value}/billing`,
        signature: offer.id,
      })
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
    // Show an independent alert for each channel that has been checked and
    // is not connected. Unknown/loading status must not be presented as absent.
    const socialChannels = [
      { key: 'facebook', label: 'Facebook', status: meta.value?.connection?.status, query: 'channel=Facebook' },
      { key: 'instagram', label: 'Instagram', status: instagram.value?.connection?.status, query: 'channel=Instagram' },
      { key: 'tiktok', label: 'TikTok', status: tiktok.value?.connection?.status, query: 'channel=TikTok' },
    ]
    for (const channel of socialChannels) {
      if (channel.status !== undefined && channel.status !== 'connected')
        list.push({
          key: `connection-${channel.key}`,
          icon: 'i-lucide-link',
          tone: 'neutral',
          title: t('nav.channelNotConnected', { channel: channel.label }),
          description: t('nav.channelNotConnectedDescription', { channel: channel.label }),
          to: `${base.value}/social-posts?${channel.query}`,
          signature: channel.status,
        })
    }
    return list
  })

  function trialRemaining(seconds: number | undefined) {
    const hours = (seconds || 0) / 3600
    return hours >= 24
      ? `${Math.floor(hours / 24)} ${t('trial.days')}`
      : `${Math.max(1, Math.floor(hours))} ${t('trial.hours')}`
  }

  // Read and snoozed notices are remembered per business in this browser;
  // they are the viewer's own housekeeping, not shared with the team.
  const storageKey = computed(() => `rrit:notifications:${base.value}`)
  const marks = useState<Marks>('notification-marks', () => ({
    read: { ...EMPTY_MARKS.read },
    snoozedUntil: { ...EMPTY_MARKS.snoozedUntil },
  }))
  const now = ref(Date.now())
  let reminderTimer: ReturnType<typeof setTimeout> | undefined
  let scheduledReminderAt: number | undefined
  const loaded = useState('notification-marks-loaded', () => '')
  if (import.meta.client && loaded.value !== storageKey.value) {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey.value) || 'null') as Partial<Marks> | null
      marks.value = {
        read: stored?.read || {},
        snoozedUntil: stored?.snoozedUntil || {},
      }
    } catch {
      marks.value = {
        read: { ...EMPTY_MARKS.read },
        snoozedUntil: { ...EMPTY_MARKS.snoozedUntil },
      }
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
  const items = computed<NotificationItem[]>(() => {
    const pending = Object.values(marks.value.snoozedUntil).filter((until) => until > now.value)
    if (import.meta.client && pending.length) {
      const nextReminder = Math.min(...pending)
      if (scheduledReminderAt !== nextReminder) {
        if (reminderTimer) clearTimeout(reminderTimer)
        scheduledReminderAt = nextReminder
        reminderTimer = setTimeout(() => {
          now.value = Date.now()
          reminderTimer = undefined
          scheduledReminderAt = undefined
        }, Math.max(0, nextReminder - now.value))
      }
    } else if (reminderTimer) {
      clearTimeout(reminderTimer)
      reminderTimer = undefined
      scheduledReminderAt = undefined
    }
    return all.value
      .filter((item) => (marks.value.snoozedUntil[item.key] || 0) <= now.value)
      .map((item) => ({ ...item, read: marks.value.read[item.key] === item.signature }))
  })
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
    const until = Date.now() + REMINDER_SNOOZE_MS
    marks.value.snoozedUntil[item.key] = until
    now.value = Date.now()
    persist()
  }
  function removeAll() {
    const snoozedUntil = Date.now() + REMINDER_SNOOZE_MS
    for (const item of items.value) marks.value.snoozedUntil[item.key] = snoozedUntil
    now.value = Date.now()
    persist()
  }

  if (import.meta.client) {
    onScopeDispose(() => {
      if (reminderTimer) clearTimeout(reminderTimer)
    })
  }

  return { items, unread, markRead, toggleRead, markAllRead, remove, removeAll }
}
