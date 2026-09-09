import { expect } from 'vitest'

type QueryResult = { rowCount: number | null; rows: Array<{ id: string }> }

export async function assertAllowed<T>(operation: () => Promise<T>) {
  return await operation()
}

export async function assertDenied(operation: () => Promise<unknown>, code = '42501') {
  await expect(operation()).rejects.toMatchObject({ code })
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
