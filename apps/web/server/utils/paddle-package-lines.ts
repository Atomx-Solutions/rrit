export type PaddlePackageLine = {
  quantity: number
  unitAmountCents: number
  name: string
  description: string
}

type PackageRow = {
  posts_included: number
  videos_included: number
  credits_included: number
  price_cents: number
  post_price_cents: number
  video_price_cents: number
}

/**
 * The lines Paddle charges for a package. Whatever the mix, they always add up
 * to price_cents: credits take what posts and videos leave, and a price the
 * per-unit rates cannot explain (a negotiated total) is charged as one line.
 *
 * `adjustable` is true only when the checkout may change the quantity safely:
 * one line whose quantity is the package's own count, so the webhook can write
 * the quantity Paddle reports straight back as that count.
 */
export function paddlePackageLines(row: PackageRow, name: string): { lines: PaddlePackageLine[]; adjustable: boolean } {
  const lines: PaddlePackageLine[] = []
  if (row.posts_included > 0)
    lines.push({ quantity: row.posts_included, unitAmountCents: row.post_price_cents, name: 'Framic — Post', description: 'Framic posts' })
  if (row.videos_included > 0)
    lines.push({ quantity: row.videos_included, unitAmountCents: row.video_price_cents, name: 'Framic — Video', description: 'Framic videos' })

  const remainder = row.price_cents - lines.reduce((sum, line) => sum + line.quantity * line.unitAmountCents, 0)
  if (row.credits_included > 0 && remainder > 0) {
    lines.push(remainder % row.credits_included === 0
      ? { quantity: row.credits_included, unitAmountCents: remainder / row.credits_included, name: 'Framic — Credit', description: 'Framic credits' }
      : { quantity: 1, unitAmountCents: remainder, name: `Framic — ${row.credits_included} credits`, description: 'Framic credits' })
  } else if (remainder !== 0 || lines.some(line => line.unitAmountCents <= 0)) {
    return { lines: [{ quantity: 1, unitAmountCents: row.price_cents, name, description: name }], adjustable: false }
  }

  const counts = [row.posts_included, row.videos_included, row.credits_included].filter(count => count > 0)
  const adjustable = lines.length === 1 && counts.length === 1 && lines[0]!.quantity === counts[0]
  return { lines, adjustable }
}
