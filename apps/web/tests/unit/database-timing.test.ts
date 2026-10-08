import { afterEach, expect, it, vi } from 'vitest'
import { withUserTransaction } from '../../server/utils/database'

const queries: string[] = []
const release = vi.fn()
vi.mock('pg', () => ({
  default: {
    Pool: class {
      on() {}
      async connect() {
        return {
          query: async (sql: string) => {
            queries.push(sql)
            return { rows: [] }
          },
          release,
        }
      }
    },
  },
}))

afterEach(() => {
  queries.length = 0
  release.mockClear()
  vi.unstubAllEnvs()
})

it('reports setup and commit timings without changing transaction order', async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://test@localhost/test')
  const phases: string[] = []
  const result = await withUserTransaction('user-1', async (client) => {
    await client.query('SELECT 42')
    return 42
  }, (phase, duration) => {
    expect(duration).toBeGreaterThanOrEqual(0)
    phases.push(phase)
  })

  expect(result).toBe(42)
  expect(phases).toEqual(['connect', 'begin', 'role', 'userContext', 'commit'])
  expect(queries).toEqual([
    'BEGIN',
    'SET LOCAL ROLE app_runtime',
    "SELECT set_config('app.user_id',$1,true), set_config('app.organization_id','',true)",
    'SELECT 42',
    'COMMIT',
  ])
  expect(release).toHaveBeenCalledOnce()
})
