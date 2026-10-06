import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A trial funds its posts at the rate the superadmin configures, and the rate
// lives in platform_settings, which the runtime role cannot read. The migration
// exposes the one number rather than the whole table.
const migration = readFileSync(
  new URL('../../database/migrations/20261006140000_trial_credits_per_post.sql', import.meta.url),
  'utf8',
)
const trials = readFileSync(new URL('../../server/utils/trials.ts', import.meta.url), 'utf8')

describe('trial credit rate', () => {
  it('reads the rate the admin panel writes', () => {
    expect(migration).toContain(
      'SELECT custom_package_credits_per_post FROM public.platform_settings WHERE singleton',
    )
  })

  it('exposes the rate without exposing the settings table', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.credits_per_post() FROM PUBLIC')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.credits_per_post() TO app_runtime')
    expect(migration).not.toMatch(/GRANT SELECT ON public\.platform_settings/)
  })

  it('pins the search path of the definer function', () => {
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain('SET search_path = pg_catalog')
  })

  // The two numbers a trial is built from are both configured, so neither may
  // be restated in the application.
  it('leaves no rate or allowance written into the trial grant', () => {
    expect(trials).toContain('public.credits_per_post()')
    expect(trials).toContain('WHERE is_trial=true')
    expect(trials).toContain('const monthlyCredits = trialPosts * creditsPerPost')
    // Neither factor may be a literal, which is how 80 survived here before.
    const assignment = /const monthlyCredits =[^\n]*/.exec(trials)?.[0] || ''
    expect(assignment).not.toMatch(/\d/)
  })

  it('grants nothing when either number is missing', () => {
    expect(trials).toContain('if (!trialPosts) return')
    expect(trials).toContain('if (!creditsPerPost) return')
  })
})
