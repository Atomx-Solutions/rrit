export type SocialNetwork = 'instagram' | 'facebook' | 'tiktok'

export function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

/**
 * Name of the business that already holds this account, when the user is a
 * member of it. Null when the user has no access there or the lookup fails:
 * the caller still reports the account as taken.
 */
export async function socialAccountOwnerName(userId: string, network: SocialNetwork, accountId: string) {
  try {
    return await withUserTransaction(userId, async (client) => {
      const result = await client.query<{ name: string | null }>(
        'SELECT app.social_account_owner_name($1,$2) AS name',
        [network, accountId],
      )
      return result.rows[0]?.name || null
    })
  } catch {
    return null
  }
}

/** Redirect query for a taken account, naming the owner only when known. */
export function takenQuery(network: SocialNetwork, ownerName: string | null) {
  return ownerName ? `${network}=taken&owner=${encodeURIComponent(ownerName)}` : `${network}=taken`
}
