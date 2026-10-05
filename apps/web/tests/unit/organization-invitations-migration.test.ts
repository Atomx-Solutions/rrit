import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The migration cannot be executed from a developer machine without a database,
// so the properties that would be expensive to discover in production are
// asserted against its text: where its functions live, how they are hardened,
// and who is allowed to call them.
const sql = readFileSync(
  new URL('../../database/migrations/20261006090000_organization_invitations.sql', import.meta.url),
  'utf8',
)

const newFunctions = [
  'admin_create_organization_invitation',
  'admin_revoke_organization_invitation',
  'admin_resend_organization_invitation',
  'admin_organization_invitations',
  'organization_invitation_preview',
  'accept_organization_invitation',
  'expire_organization_invitations',
  'remove_abandoned_invited_organizations',
]

const auditScopeSql = readFileSync(
  new URL(
    '../../database/migrations/20261006100000_organization_invitation_audit_scope.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('invitation audit scope', () => {
  // The invitation audit row has no tenant, which the scope constraint rejects
  // unless its resource type is listed among the platform-scoped ones.
  it('admits the invitation resource type without a tenant', () => {
    expect(auditScopeSql).toContain("'organization_invitation'")
    expect(auditScopeSql).toContain('ADD CONSTRAINT audit_events_scope_check')
  })

  it('keeps every resource type the constraint already admitted', () => {
    for (const type of [
      'plan',
      'credit_pricing',
      'invoice_settings',
      'platform_settings',
      'package_request',
      'custom_package',
    ])
      expect(auditScopeSql).toContain(`'${type}'`)
  })

  it('still requires a tenant for everything else', () => {
    expect(auditScopeSql).toContain(
      '(organization_id IS NOT NULL AND business_id IS NOT NULL)',
    )
  })
})

const handoverSql = readFileSync(
  new URL(
    '../../database/migrations/20261006110000_invitation_owner_handover.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('invitation owner handover', () => {
  // 0026 requires every organization to keep an active owner membership for its
  // created_by. An invitation has no client yet, so the superadmin holds the
  // organization until acceptance rather than the invariant being relaxed.
  it('leaves the 0026 owner invariant untouched', () => {
    expect(handoverSql).not.toContain('DROP TRIGGER')
    expect(handoverSql).not.toContain('organization_require_designated_owner')
    expect(handoverSql).not.toContain('organization_preserve_owner_membership')
  })

  it('gives the new organization a caretaker owner', () => {
    expect(handoverSql).toMatch(
      /INSERT INTO public\.organization_memberships[\s\S]{0,200}VALUES \(v_organization\.id, p_actor_id, 'owner'/,
    )
  })

  it('moves created_by and drops the caretaker when the client accepts', () => {
    expect(handoverSql).toContain('SET created_by = v_user')
    expect(handoverSql).toMatch(/DELETE FROM public\.organization_memberships[\s\S]{0,160}invitation\.invited_by/)
  })

  it('hands over only for an owner invitation', () => {
    expect(handoverSql).toContain("IF invitation.role = 'owner'")
  })

  it('stops the cleanup from counting the caretaker as a member', () => {
    const cleanup = handoverSql.slice(
      handoverSql.indexOf('FUNCTION public.remove_abandoned_invited_organizations'),
    )
    expect(cleanup).toContain('member.user_id <> organization.created_by')
    expect(cleanup).toContain("invitation.status IN ('pending', 'accepted')")
  })
})

const listSql = readFileSync(
  new URL(
    '../../database/migrations/20261006120000_hide_unclaimed_invited_organizations.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('unclaimed invited organizations', () => {
  it('hides a placeholder that has an invitation and no business', () => {
    expect(listSql).toMatch(
      /NOT \(\s*EXISTS \([\s\S]{0,200}organization_invitations[\s\S]{0,200}AND NOT EXISTS \([\s\S]{0,160}businesses/,
    )
  })

  // An organization that never had an invitation must list exactly as before,
  // so the filter cannot be a blanket "must have a business" rule.
  it('leaves organizations without an invitation untouched', () => {
    expect(listSql).not.toMatch(/WHERE\s*\n\s*EXISTS \(\s*SELECT 1 FROM public\.businesses/)
    expect(listSql).toContain('organization_invitations')
  })

  it('keeps the status filter and the escaped name search', () => {
    expect(listSql).toContain('public.organization_state(organization.id) = p_status')
    expect(listSql).toContain("ESCAPE '\\'")
  })

  it('stays available only to the superadmin role', () => {
    expect(listSql).toContain(
      'REVOKE ALL ON FUNCTION public.admin_list_organizations(integer, integer, text, text) FROM PUBLIC',
    )
    expect(listSql).toContain('TO service_role')
    expect(listSql).not.toContain('TO app_runtime')
  })
})

const claimedSql = readFileSync(
  new URL(
    '../../database/migrations/20261006130000_overview_excludes_unclaimed_organizations.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('claimed organizations view', () => {
  it('states the placeholder rule exactly once', () => {
    const occurrences = claimedSql.match(/organization_invitations AS invitation/g) || []
    expect(occurrences.length).toBe(1)
    expect(claimedSql).toContain('CREATE OR REPLACE VIEW public.claimed_organizations')
  })

  // Both readers must go through the view, or the counters and the list would
  // disagree about which organizations are real.
  it('routes the overview and the list through the view', () => {
    const overview = claimedSql.slice(
      claimedSql.indexOf('FUNCTION public.admin_overview_kpis'),
      claimedSql.indexOf('FUNCTION public.admin_list_organizations'),
    )
    const listing = claimedSql.slice(claimedSql.indexOf('FUNCTION public.admin_list_organizations'))
    expect(overview).not.toContain('public.organizations')
    expect(listing).not.toContain('public.organizations')
    expect(overview).toContain('public.claimed_organizations')
    expect(listing).toContain('public.claimed_organizations')
  })

  it('keeps the view away from every role but the superadmin', () => {
    expect(claimedSql).toContain('REVOKE ALL ON public.claimed_organizations FROM PUBLIC')
    expect(claimedSql).toContain('GRANT SELECT ON public.claimed_organizations TO service_role')
    expect(claimedSql).not.toContain('claimed_organizations TO app_runtime')
  })
})

describe('organization invitations migration', () => {
  it('protects the invitation table with row level security', () => {
    expect(sql).toContain('ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON TABLE public.organization_invitations FROM PUBLIC')
  })

  it('stores a hash rather than a usable token', () => {
    expect(sql).toContain("token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$')")
    // Every function that returns an invitation strips the hash from the row.
    expect(sql).not.toMatch(/to_jsonb\((?:v_invitation|before_row|after_row|invitation)\)(?!\s*-\s*'token_hash')/)
  })

  it('allows only one open invitation per organization', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX organization_invitations_pending_organization')
    expect(sql).toMatch(/organization_invitations_pending_organization[\s\S]*WHERE status = 'pending'/)
  })

  // The test helper isolates a migration by rewriting "public."; anything this
  // migration creates in another schema would escape that isolation and alter
  // the live database during a test run.
  it('creates every new function in the public schema', () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION app\./)
    for (const name of newFunctions)
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${name}`)
  })

  it('pins the search path of every security definer function', () => {
    const definers = sql.match(/SECURITY DEFINER[^\n]*/g) || []
    expect(definers.length).toBe(newFunctions.length)
    for (const line of definers) expect(line).toContain('SET search_path = pg_catalog')
  })

  it('revokes every new function from PUBLIC before granting it', () => {
    for (const name of newFunctions)
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`))
  })

  it('keeps the client role away from the superadmin functions', () => {
    const grants = sql.slice(sql.indexOf('DO $$ BEGIN'))
    for (const name of newFunctions.filter((name) => name.startsWith('admin_'))) {
      expect(grants).toMatch(new RegExp(`${name}[\\s\\S]{0,80}TO service_role`))
      expect(grants).not.toMatch(new RegExp(`${name}[\\s\\S]{0,80}TO app_runtime`))
    }
  })

  // COALESCE, NULLIF and friends are parser constructs rather than functions,
  // so schema-qualifying them is a syntax error the database only reports when
  // the migration runs. A pinned search_path does not require qualifying them.
  it('never schema-qualifies a SQL construct', () => {
    const constructs = [
      'coalesce',
      'nullif',
      'greatest',
      'least',
      'extract',
      'trim',
      'substring',
      'position',
      'overlay',
      'cast',
    ]
    for (const construct of constructs)
      expect(sql.toLowerCase()).not.toContain(`pg_catalog.${construct}(`)
  })

  it('verifies the invited address against auth.users rather than trusting the caller', () => {
    expect(sql).toContain('SELECT pg_catalog.lower(email) INTO v_email FROM auth.users WHERE id = v_user')
    expect(sql).toContain('INVITATION_EMAIL_MISMATCH')
  })

  it('gives the business the organization id so the waiting package stays attached', () => {
    expect(sql).toContain('INSERT INTO public.businesses (id, owner_id, slug, state)')
    expect(sql).toContain('VALUES (invitation.organization_id, v_user, p_slug, p_state)')
  })

  it('refuses an acceptance from a user who already owns a workspace', () => {
    expect(sql).toContain('BUSINESS_EXISTS')
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM public\.businesses WHERE owner_id = v_user\)/)
  })

  it('closes an expired invitation instead of accepting it', () => {
    expect(sql).toContain('INVITATION_EXPIRED')
    expect(sql).toMatch(/invitation\.expires_at <= pg_catalog\.now\(\)/)
  })

  it('only removes an abandoned organization that nothing is attached to', () => {
    const cleanup = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.remove_abandoned'))
    for (const table of ['organization_memberships', 'businesses', 'custom_packages'])
      expect(cleanup).toMatch(new RegExp(`NOT EXISTS \\(SELECT 1 FROM public\\.${table}`))
    expect(cleanup).toMatch(/invitation\.status = 'pending'/)
  })
})
