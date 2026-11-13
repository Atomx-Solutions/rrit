import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { accountAlreadyExists, adminEmailSchema, platformAdminFailure } from '../../server/utils/admin-platform-admins'

// The migration cannot run from a developer machine without a database, so the
// properties that matter for security are asserted against its text.
const sql = readFileSync(
  new URL('../../database/migrations/20261113100000_platform_admin_management.sql', import.meta.url),
  'utf8',
)
const previousScopeSql = readFileSync(
  new URL('../../database/migrations/20261102170000_music_moods.sql', import.meta.url),
  'utf8',
)

const functions = [
  ['admin_list_platform_admins', '()'],
  ['admin_grant_superadmin', '(uuid, text, text)'],
  ['admin_revoke_superadmin', '(uuid, text, uuid)'],
] as const

function functionBody(name: string) {
  const start = sql.indexOf(`FUNCTION public.${name}(`)
  return sql.slice(start, sql.indexOf('$function$;', start))
}

describe('platform admin management migration', () => {
  it.each(functions)('runs %s as a hardened security definer', (name) => {
    const body = functionBody(name)
    expect(body).toContain('SECURITY DEFINER')
    expect(body).toContain('SET search_path = pg_catalog')
  })

  // A function the public roles may execute is reachable through PostgREST
  // with the anon key, bypassing the /api/admin guard entirely.
  it.each(functions)('keeps %s away from the public roles', (name, args) => {
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}${args} FROM PUBLIC;`)
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}${args} FROM anon;`)
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}${args} FROM authenticated;`)
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${name}${args} TO service_role;`)
  })

  it.each(['admin_grant_superadmin', 'admin_revoke_superadmin'])(
    '%s checks the actor is a superadmin itself',
    (name) => {
      expect(functionBody(name)).toContain("RAISE EXCEPTION 'SUPERADMIN_REQUIRED'")
    },
  )

  it('grants the role only to an account that holds the company Microsoft identity', () => {
    const body = functionBody('admin_grant_superadmin')
    expect(body).toContain("provider = 'azure'")
    expect(body).toContain("RAISE EXCEPTION 'ADMIN_MICROSOFT_ACCOUNT_REQUIRED'")
  })

  it('never removes the actor or the last superadmin', () => {
    const body = functionBody('admin_revoke_superadmin')
    expect(body).toContain("RAISE EXCEPTION 'ADMIN_CANNOT_REMOVE_SELF'")
    expect(body).toContain("RAISE EXCEPTION 'ADMIN_LAST_REMAINING'")
    // Concurrent removals are serialised before the count is taken.
    expect(body.indexOf('FOR UPDATE')).toBeLessThan(body.indexOf('ADMIN_LAST_REMAINING'))
  })

  it.each(['admin_grant_superadmin', 'admin_revoke_superadmin'])('audits every change made by %s', (name) => {
    expect(functionBody(name)).toContain("public.admin_record_platform_change(")
    expect(functionBody(name)).toContain("'platform_admin'")
  })

  it('admits the new audit resource and keeps every one admitted before', () => {
    const listed = (text: string) => {
      const block = text.slice(text.lastIndexOf('ADD CONSTRAINT audit_events_scope_check'))
      return [...block.slice(0, block.indexOf(';')).matchAll(/'([a-z_]+)'/g)].map(match => match[1])
    }
    const before = listed(previousScopeSql)
    const after = listed(sql)
    expect(after).toEqual(expect.arrayContaining(before))
    expect(after).toContain('platform_admin')
  })
})

describe('platform admin API values', () => {
  it('accepts one email and nothing else', () => {
    expect(adminEmailSchema.safeParse({ email: 'name@company.com' }).success).toBe(true)
    expect(adminEmailSchema.safeParse({ email: 'not-an-email' }).success).toBe(false)
    expect(adminEmailSchema.safeParse({ email: 'name@company.com', role: 'superadmin' }).success).toBe(false)
  })

  it.each([
    ['ADMIN_ACCOUNT_NOT_FOUND', 404],
    ['ADMIN_ALREADY_EXISTS', 409],
    ['ADMIN_LAST_REMAINING', 409],
    ['SUPERADMIN_REQUIRED', 403],
  ])('maps the database refusal %s', (code, statusCode) => {
    expect(platformAdminFailure(`ERROR: ${code}`)).toEqual({ code, statusCode })
  })

  it('leaves unknown database errors unmapped', () => {
    expect(platformAdminFailure('connection reset')).toBeNull()
    expect(platformAdminFailure(undefined)).toBeNull()
  })

  // Adding an address that already has an account must reuse it, not fail.
  it.each([
    { code: 'email_exists' },
    { status: 422 },
    { message: 'A user with this email address has already been registered' },
  ])('treats %o as an existing account', (error) => {
    expect(accountAlreadyExists(error)).toBe(true)
  })

  it('treats other account errors as failures', () => {
    expect(accountAlreadyExists({ status: 500, message: 'Database error' })).toBe(false)
  })
})

const grantBeforeSignInSql = readFileSync(
  new URL('../../database/migrations/20261113110000_grant_superadmin_before_first_sign_in.sql', import.meta.url),
  'utf8',
)

describe('granting the role before the first Microsoft sign-in', () => {
  it('still checks the actor is a superadmin and audits the change', () => {
    expect(grantBeforeSignInSql).toContain("RAISE EXCEPTION 'SUPERADMIN_REQUIRED'")
    expect(grantBeforeSignInSql).toContain('public.admin_record_platform_change(')
    expect(grantBeforeSignInSql).toContain('SECURITY DEFINER')
    expect(grantBeforeSignInSql).toContain('SET search_path = pg_catalog')
  })

  it('keeps the replaced function away from the public roles', () => {
    const fn = 'public.admin_grant_superadmin(uuid, text, text)'
    expect(grantBeforeSignInSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`)
    expect(grantBeforeSignInSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon;`)
    expect(grantBeforeSignInSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM authenticated;`)
    expect(grantBeforeSignInSql).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role;`)
  })
})
