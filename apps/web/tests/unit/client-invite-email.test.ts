import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/utils/admin-supabase', () => ({ adminServiceClient: vi.fn() }))

const { adminServiceClient } = await import('../../server/utils/admin-supabase')
const { APP_LANGUAGES } = await import('../../shared/utils/app-languages')
const { CLIENT_INVITE_KEYS, clientInviteEmail, emailPalette, validityText } = await import('../../server/utils/client-invite-email')
const {
  createOrganizationInvitation,
  emailInvitation,
  invitationCreateSchema,
  invitationResendSchema,
} = await import('../../server/utils/organization-invitations')

const css = readFileSync(new URL('../../app/assets/css/main.css', import.meta.url), 'utf8')
function lightToken(name: string) {
  return css.match(new RegExp(`--rrit-color-${name}:\\s*([^;]+);`))?.[1]?.trim()
}
function dictionary(language: string) {
  return JSON.parse(readFileSync(new URL(`../../app/locales/client/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>
}

const input = {
  language: 'sq' as const,
  appOrigin: 'https://app.example.com',
  organizationName: 'Kafe Dielli',
  inviteeEmail: 'client@example.com',
  url: 'https://app.example.com/join?token=abc',
  validMinutes: 60,
}

describe('client invitation email', () => {
  it.each(Object.entries(emailPalette))("uses the app's light %s colour", (name, value) => {
    expect(lightToken(name)).toBe(value)
  })

  it.each(APP_LANGUAGES)('has every text translated in %s', (language) => {
    const words = dictionary(language)
    expect(CLIENT_INVITE_KEYS.filter(key => !words[key])).toEqual([])
  })

  it.each(APP_LANGUAGES)('links to the invitation in %s', (language) => {
    const email = clientInviteEmail({ ...input, language })
    expect(email.html).toContain(`lang="${language}"`)
    expect(email.html).toContain(`href="${input.url}"`)
    expect(email.text).toContain(input.url)
    expect(email.subject).toContain(input.organizationName)
    expect(email.html).not.toMatch(/\{\{\w+\}\}/)
  })

  it('escapes the organization name so it cannot inject markup', () => {
    const { html } = clientInviteEmail({ ...input, organizationName: '<script>x</script>' })
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;')
  })

  it('says how long the link stays valid in words', () => {
    expect(validityText('en', 60)).toBe('1 hour')
    expect(validityText('en', 5)).toBe('5 minutes')
    expect(validityText('en', 90)).toMatch(/^1 hour.*30 minutes$/)
    expect(validityText('en', 0.2)).toBe('1 minute')
  })
})

describe('invitation request bodies', () => {
  it('keeps the email off unless asked, in a known language', () => {
    const base = { name: 'Kafe Dielli', slug: 'kafe-dielli', email: 'client@example.com' }
    expect(invitationCreateSchema.parse(base)).toMatchObject({ send_email: false, language: APP_LANGUAGES[0] })
    expect(invitationCreateSchema.safeParse({ ...base, send_email: true, language: 'de' }).success).toBe(true)
    expect(invitationCreateSchema.safeParse({ ...base, language: 'xx' }).success).toBe(false)
    expect(invitationResendSchema.safeParse({ send_email: true, language: 'fr' }).success).toBe(true)
  })
})

describe('emailing an invitation', () => {
  const delivery = {
    send: true,
    language: 'en' as const,
    email: 'client@example.com',
    organizationName: 'Kafe Dielli',
    url: 'https://app.example.com/join?token=abc',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends nothing when the superadmin did not ask for it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(emailInvitation({ ...delivery, send: false })).resolves.toBe('not_requested')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a missing Brevo key instead of failing', async () => {
    vi.stubEnv('BREVO_API_KEY', '')
    vi.stubEnv('BREVO_SENDER_EMAIL', 'noreply@example.com')
    await expect(emailInvitation(delivery)).resolves.toBe('not_configured')
  })

  it('sends through the Brevo API from the configured sender', async () => {
    vi.stubEnv('BREVO_API_KEY', 'test-key')
    vi.stubEnv('BREVO_SENDER_EMAIL', 'noreply@example.com')
    vi.stubEnv('BREVO_SENDER_NAME', 'Example')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: 'm-1' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(emailInvitation(delivery)).resolves.toBe('sent')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(init.headers['api-key']).toBe('test-key')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ sender: { email: 'noreply@example.com', name: 'Example' }, to: [{ email: 'client@example.com' }] })
    expect(body.htmlContent).toContain(delivery.url)
  })

  it('reports a refused send without throwing, since the invitation is saved', async () => {
    vi.stubEnv('BREVO_API_KEY', 'test-key')
    vi.stubEnv('BREVO_SENDER_EMAIL', 'noreply@example.com')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized ip', { status: 401 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(emailInvitation(delivery)).resolves.toBe('failed')
  })
})

describe('creating an invitation', () => {
  const rpc = vi.fn()
  beforeEach(() => {
    vi.stubEnv('APP_URL', 'https://app.example.com')
    vi.stubEnv('BREVO_API_KEY', '')
    vi.mocked(adminServiceClient).mockReturnValue({ rpc } as never)
    rpc.mockResolvedValue({
      data: {
        organization: { id: 'o-1', name: 'Kafe Dielli' },
        invitation: { email: 'client@example.com', expires_at: new Date(Date.now() + 3_600_000).toISOString(), organization_id: 'o-1' },
      },
      error: null,
    })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('keeps the delivery choice out of the stored invitation and still returns the link', async () => {
    const values = invitationCreateSchema.parse({
      name: 'Kafe Dielli', slug: 'kafe-dielli', email: 'client@example.com', send_email: true, language: 'de',
    })
    const result = await createOrganizationInvitation({ id: 'a-1', email: 'owner@example.com' }, values)
    const stored = rpc.mock.calls[0]![1].p_invitation
    expect(stored).not.toHaveProperty('send_email')
    expect(stored).not.toHaveProperty('language')
    expect(result.url).toMatch(/^https:\/\/app\.example\.com\/join\?token=/)
    expect(result.delivery).toBe('not_configured')
  })
})
