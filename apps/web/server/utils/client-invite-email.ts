import de from '../../app/locales/client/de.json'
import en from '../../app/locales/client/en.json'
import fr from '../../app/locales/client/fr.json'
import it from '../../app/locales/client/it.json'
import sq from '../../app/locales/client/sq.json'
import tr from '../../app/locales/client/tr.json'
import { FALLBACK_LANGUAGE, type AppLanguage } from '../../shared/utils/app-languages'

// The email reads the client app's own dictionaries, so its words are
// translated, reviewed and fall back to English exactly like the app's.
const dictionaries: Record<AppLanguage, Record<string, string>> = { sq, en, de, it, fr, tr }

/** Every text the invitation email needs from the dictionaries. */
export const CLIENT_INVITE_KEYS = [
  'invitationEmail.subject',
  'invitationEmail.preheader',
  'invitationEmail.eyebrow',
  'invitationEmail.title',
  'invitationEmail.lead',
  'invitationEmail.accountLabel',
  'invitationEmail.button',
  'invitationEmail.validity',
  'invitationEmail.stepsTitle',
  'invitationEmail.step1',
  'invitationEmail.step2',
  'invitationEmail.step3',
  'invitationEmail.expiredNote',
  'invitationEmail.fallback',
  'invitationEmail.ignore',
] as const
type Key = typeof CLIENT_INVITE_KEYS[number]

// Email clients cannot read the app's CSS variables, so the light theme's
// --rrit-color-* values are restated here. A unit test compares each one with
// app/assets/css/main.css, so they cannot drift apart unnoticed.
export const emailPalette = {
  canvas: '#f7f8f6',
  surface: '#fff',
  text: '#202822',
  muted: '#66716c',
  border: '#e8ece8',
  primary: '#147653',
  'primary-subtle': '#edf6ee',
  warm: '#f7f4ed',
} as const

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}

function translator(language: AppLanguage) {
  return (key: Key, params: Record<string, string> = {}) => {
    const value = dictionaries[language][key] || dictionaries[FALLBACK_LANGUAGE][key] || key
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => params[name] ?? '')
  }
}

/** "24 hours", "1 Stunde 30 Minuten": how long the link stays valid, in words. */
export function validityText(language: AppLanguage, minutes: number) {
  const whole = Math.max(1, Math.round(minutes))
  const unit = (value: number, name: 'hour' | 'minute') =>
    new Intl.NumberFormat(language, { style: 'unit', unit: name, unitDisplay: 'long' }).format(value)
  const parts = [
    ...(whole >= 60 ? [unit(Math.floor(whole / 60), 'hour')] : []),
    ...(whole % 60 ? [unit(whole % 60, 'minute')] : []),
  ]
  return new Intl.ListFormat(language, { style: 'long', type: 'unit' }).format(parts)
}

export interface ClientInviteInput {
  language: AppLanguage
  appOrigin: string
  organizationName: string
  inviteeEmail: string
  url: string
  /** Minutes until the link expires. */
  validMinutes: number
}

const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"

export function clientInviteEmail(input: ClientInviteInput) {
  const t = translator(input.language)
  const p = emailPalette
  const origin = input.appOrigin.replace(/\/$/, '')
  const organization = input.organizationName
  const duration = validityText(input.language, input.validMinutes)
  const url = escapeHtml(input.url)
  const subject = t('invitationEmail.subject', { organization })
  const steps = (['invitationEmail.step1', 'invitationEmail.step2', 'invitationEmail.step3'] as const).map(key => t(key))

  const stepRows = steps.map((step, index) => `
                <tr>
                  <td width="36" valign="top" style="padding:0 12px 12px 0;"><div style="width:24px;height:24px;border-radius:12px;background:${p['primary-subtle']};color:${p.primary};${font}font-size:12px;font-weight:700;line-height:24px;text-align:center;">${index + 1}</div></td>
                  <td valign="top" style="padding:2px 0 12px 0;${font}font-size:14px;line-height:1.5;color:${p.text};">${escapeHtml(step)}</td>
                </tr>`).join('')

  const html = `<!DOCTYPE html>
<html lang="${input.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${p.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(t('invitationEmail.preheader'))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.canvas};">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 20px 4px;">
        <img src="${escapeHtml(origin)}/framic-logo.png" width="112" alt="Framic" style="display:block;border:0;width:112px;height:auto;">
      </td></tr>
      <tr><td style="background:${p.surface};border:1px solid ${p.border};border-radius:16px;overflow:hidden;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="height:4px;background:${p.primary};font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:32px 32px 0 32px;">
            <span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${p['primary-subtle']};color:${p.primary};${font}font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(t('invitationEmail.eyebrow'))}</span>
            <h1 style="margin:16px 0 8px 0;${font}font-size:24px;line-height:1.3;font-weight:700;color:${p.text};">${escapeHtml(t('invitationEmail.title'))}</h1>
            <p style="margin:0;${font}font-size:16px;line-height:1.55;color:${p.muted};">${escapeHtml(t('invitationEmail.lead', { organization }))}</p>
          </td></tr>
          <tr><td style="padding:24px 32px 0 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${p.border};border-radius:12px;">
              <tr><td style="padding:14px 16px;">
                <p style="margin:0 0 4px 0;${font}font-size:12px;line-height:1.4;color:${p.muted};">${escapeHtml(t('invitationEmail.accountLabel'))}</p>
                <p style="margin:0;${font}font-size:15px;font-weight:600;line-height:1.4;color:${p.text};">${escapeHtml(organization)}</p>
                <p style="margin:2px 0 0 0;${font}font-size:14px;line-height:1.4;color:${p.muted};word-break:break-all;">${escapeHtml(input.inviteeEmail)}</p>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:24px 32px 0 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="border-radius:10px;background:${p.primary};">
                <a href="${url}" style="display:inline-block;padding:14px 28px;${font}font-size:16px;font-weight:600;color:${p.surface};text-decoration:none;border-radius:10px;">${escapeHtml(t('invitationEmail.button'))}</a>
              </td>
            </tr></table>
            <p style="margin:12px 0 0 0;${font}font-size:13px;line-height:1.5;color:${p.muted};">${escapeHtml(t('invitationEmail.validity', { duration }))}</p>
          </td></tr>
          <tr><td style="padding:28px 32px 0 32px;">
            <p style="margin:0 0 14px 0;${font}font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${p.muted};">${escapeHtml(t('invitationEmail.stepsTitle'))}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${stepRows}
            </table>
          </td></tr>
          <tr><td style="padding:12px 32px 0 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.warm};border-radius:12px;">
              <tr><td style="padding:14px 16px;${font}font-size:13px;line-height:1.55;color:${p.text};">${escapeHtml(t('invitationEmail.expiredNote'))}</td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:24px 32px 32px 32px;${font}font-size:12px;line-height:1.55;color:${p.muted};">
            ${escapeHtml(t('invitationEmail.fallback'))}<br>
            <a href="${url}" style="color:${p.primary};word-break:break-all;">${url}</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 8px 0 8px;${font}font-size:12px;line-height:1.55;color:${p.muted};text-align:center;">
        ${escapeHtml(t('invitationEmail.ignore'))}<br>
        Framic &middot; ${escapeHtml(new URL(origin).host)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

  const text = [
    t('invitationEmail.title'),
    '',
    t('invitationEmail.lead', { organization }),
    '',
    `${t('invitationEmail.accountLabel')}: ${organization} (${input.inviteeEmail})`,
    '',
    `${t('invitationEmail.button')}: ${input.url}`,
    t('invitationEmail.validity', { duration }),
    '',
    `${t('invitationEmail.stepsTitle')}:`,
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    t('invitationEmail.expiredNote'),
    '',
    t('invitationEmail.ignore'),
  ].join('\n')

  return { subject, html, text }
}
