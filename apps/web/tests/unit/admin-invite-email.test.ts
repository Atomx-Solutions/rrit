import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/utils/admin-supabase', () => ({ adminServiceClient: vi.fn() }))

const { adminServiceClient } = await import('../../server/utils/admin-supabase')
const {
  ADMIN_INVITE_DATA,
  ADMIN_INVITE_LOCALES,
  ADMIN_SIGN_IN_PATH,
  adminEmailDomains,
  adminEmailSchema,
  adminInviteSchema,
  grantPlatformAdmin,
} = await import('../../server/utils/admin-platform-admins')
const { MICROSOFT_LOGO_COLORS } = await import('../../shared/utils/microsoft-logo')

// The Supabase "Invite user" template lives in the repository so it can be
// reviewed; these checks keep it in step with the code that fills it.
const template = readFileSync(new URL('../../../../docs/email-templates/invite-user.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../app/assets/css/main.css', import.meta.url), 'utf8')

// The light theme is the first block that defines the --rrit-color-* tokens.
const lightTheme = css.slice(css.indexOf('--rrit-color-canvas'), css.indexOf('--rrit-color-marketing-canvas'))
const lightColors = new Set([...lightTheme.matchAll(/--rrit-color-[\w-]+:\s*(#[0-9a-f]{3,8});/gi)].map(match => match[1]!.toLowerCase()))

describe('Supabase administrator invitation template', () => {
  it('links its button to the invitation', () => {
    expect(template).toContain('href="{{ .ConfirmationURL }}"')
    expect(template).toContain('{{ .Email }}')
  })

  it('reads the data the console sends with the invitation', () => {
    expect(template).toContain(`.Data.${ADMIN_INVITE_DATA.invitedBy}`)
    expect(template).toContain(`.Data.${ADMIN_INVITE_DATA.locale}`)
  })

  it('has a branch for every console language', () => {
    // Albanian is the fallback; every other language has its own branch.
    for (const locale of ADMIN_INVITE_LOCALES.slice(1))
      expect(template).toContain(`"${locale}" }}`)
    expect(template.match(/{{ if eq /g)).toHaveLength(ADMIN_INVITE_LOCALES.length - 1)
  })

  it('uses only the app\'s light colours and Microsoft\'s logo colours', () => {
    const allowed = new Set([...lightColors, ...MICROSOFT_LOGO_COLORS])
    const used = new Set([...template.matchAll(/#[0-9a-f]{3,8}\b/gi)].map(match => match[0].toLowerCase()))
    expect(lightColors.size).toBeGreaterThan(0)
    expect([...used].filter(color => !allowed.has(color))).toEqual([])
    for (const color of MICROSOFT_LOGO_COLORS) expect(used).toContain(color)
  })
})

describe('invitation request bodies', () => {
  it('defaults the language and refuses unknown fields', () => {
    expect(adminEmailSchema.parse({ email: 'name@company.com' }).locale).toBe(ADMIN_INVITE_LOCALES[0])
    expect(adminEmailSchema.safeParse({ email: 'name@company.com', locale: 'en' }).success).toBe(true)
    expect(adminEmailSchema.safeParse({ email: 'name@company.com', locale: 'xx' }).success).toBe(false)
    expect(adminInviteSchema.safeParse({}).success).toBe(true)
    expect(adminInviteSchema.safeParse({ email: 'name@company.com' }).success).toBe(false)
  })
})

describe('company email domains', () => {
  afterEach(() => vi.unstubAllEnvs())

  it("accepts the adding administrator's own domain by default", () => {
    vi.stubEnv('ADMIN_EMAIL_DOMAINS', '')
    expect(adminEmailDomains('Owner@Example.com')).toEqual(['example.com'])
  })

  it('takes the configured list when there is one', () => {
    vi.stubEnv('ADMIN_EMAIL_DOMAINS', ' @Example.com, other.org ,example.com')
    expect(adminEmailDomains('owner@ignored.net')).toEqual(['example.com', 'other.org'])
  })
})

describe('granting an administrator', () => {
  const actor = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com' }
  const auth = { inviteUserByEmail: vi.fn(), createUser: vi.fn() }
  const rpc = vi.fn()

  beforeEach(() => {
    vi.stubEnv('APP_URL', 'https://app.example.com')
    vi.stubEnv('ADMIN_EMAIL_DOMAINS', '')
    vi.mocked(adminServiceClient).mockReturnValue({ auth: { admin: auth }, rpc } as never)
    rpc.mockResolvedValue({ data: { user_id: 'u-1', email: 'new@example.com' }, error: null })
    auth.createUser.mockResolvedValue({ error: null })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('has Supabase send the invitation to the console sign-in, then grants the role', async () => {
    auth.inviteUserByEmail.mockResolvedValue({ error: null })
    await expect(grantPlatformAdmin(actor, 'new@example.com', 'en')).resolves.toMatchObject({ invite: 'sent', user_id: 'u-1' })
    expect(auth.inviteUserByEmail).toHaveBeenCalledWith('new@example.com', {
      redirectTo: `https://app.example.com${ADMIN_SIGN_IN_PATH}`,
      data: { [ADMIN_INVITE_DATA.invitedBy]: actor.email, [ADMIN_INVITE_DATA.locale]: 'en' },
    })
    expect(auth.createUser).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('admin_grant_superadmin', expect.objectContaining({ p_email: 'new@example.com' }))
  })

  it('refuses an address outside the company before creating or emailing anything', async () => {
    await expect(grantPlatformAdmin(actor, 'someone@gmail.com', 'sq')).rejects.toMatchObject({
      statusCode: 422,
      data: { code: 'ADMIN_EMAIL_DOMAIN_NOT_ALLOWED', domains: ['example.com'] },
    })
    // A look-alike domain is not the company's either.
    await expect(grantPlatformAdmin(actor, 'someone@example.com.evil.io', 'sq')).rejects.toMatchObject({ statusCode: 422 })
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled()
    expect(auth.createUser).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('grants the role without an email when the address already has an account', async () => {
    auth.inviteUserByEmail.mockResolvedValue({ error: { status: 422, code: 'email_exists', message: 'already registered' } })
    await expect(grantPlatformAdmin(actor, 'new@example.com', 'sq')).resolves.toMatchObject({ invite: 'existing_account' })
    expect(auth.createUser).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalled()
  })

  it('still creates the account and grants the role when the email fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    auth.inviteUserByEmail.mockResolvedValue({ error: { status: 500, code: 'unexpected_failure', message: 'Error sending invite email' } })
    await expect(grantPlatformAdmin(actor, 'new@example.com', 'sq')).resolves.toMatchObject({ invite: 'failed' })
    expect(auth.createUser).toHaveBeenCalledWith({ email: 'new@example.com', email_confirm: true })
    expect(rpc).toHaveBeenCalled()
  })
})
