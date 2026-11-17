import type { Pool } from 'pg'
import { removeAssets } from './asset-storage'

// Storage accepts a bounded number of paths per removal call.
const STORAGE_BATCH = 100

export function storagePathBatches(paths: string[], size = STORAGE_BATCH) {
  const batches: string[][] = []
  for (let start = 0; start < paths.length; start += size) batches.push(paths.slice(start, start + size))
  return batches
}

/**
 * Removes the content of organizations whose closure can no longer be undone.
 * Each one is purged in its own transaction, so one failure never holds back
 * the others; its files are removed from Storage after that transaction has
 * committed, and a file left behind by a failed removal holds no data the
 * database still points to.
 */
export async function runOrganizationPurgeBatch(db: Pool, limit = 10) {
  const due = await db.query<{ id: string }>('SELECT public.organizations_due_for_purge($1) AS id', [limit])
  const purged: string[] = []
  const failed: string[] = []
  for (const { id } of due.rows) {
    let storagePaths: string[]
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<{ purge: { storage_paths: string[] } }>(
        'SELECT public.purge_closed_organization($1) AS purge',
        [id],
      )
      await client.query('COMMIT')
      storagePaths = result.rows[0]?.purge.storage_paths || []
      purged.push(id)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      failed.push(id)
      console.error('A closed organization could not be purged.', {
        organizationId: id,
        message: error instanceof Error ? error.message : 'unknown',
      })
      continue
    } finally {
      client.release()
    }
    for (const batch of storagePathBatches(storagePaths)) {
      await removeAssets(batch).catch((error: unknown) =>
        console.warn('Some files of a purged organization stayed in Storage.', {
          organizationId: id,
          message: error instanceof Error ? error.message : 'unknown',
        }))
    }
  }
  return { purged: purged.length, failed: failed.length }
}
