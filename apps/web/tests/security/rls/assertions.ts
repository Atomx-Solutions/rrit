import { expect } from 'vitest'
import type { PoolClient } from 'pg'

type QueryResult = { rowCount: number | null; rows: Array<{ id: string }> }

export async function assertAllowed<T>(operation: () => Promise<T>) {
  return await operation()
}

export async function assertDenied(operation: () => Promise<unknown>, code = '42501') {
  await expect(operation()).rejects.toMatchObject({ code })
}

let savepointNumber = 0

// PostgreSQL marks a transaction aborted after a rejected statement. Tests that
// intentionally assert a denial and then exercise more policies must recover
// before issuing the next query.
export async function assertDeniedInSavepoint(
  client: PoolClient,
  operation: () => Promise<unknown>,
  code = '42501',
) {
  const savepoint = `expected_denial_${++savepointNumber}`
  await client.query(`SAVEPOINT ${savepoint}`)
  try {
    await assertDenied(operation, code)
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await client.query(`RELEASE SAVEPOINT ${savepoint}`)
  }
}

export function assertAffectedRows(result: Pick<QueryResult, 'rowCount'>, expected: number) {
  expect(result.rowCount).toBe(expected)
}

export function assertInvisible(result: Pick<QueryResult, 'rowCount'>) {
  expect(result.rowCount).toBe(0)
}

export function assertVisibleIds(result: Pick<QueryResult, 'rows'>, expectedIds: string[]) {
  expect(result.rows.map((row) => row.id).sort()).toEqual([...expectedIds].sort())
}
