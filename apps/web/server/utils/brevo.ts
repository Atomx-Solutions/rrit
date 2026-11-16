// Transactional email through Brevo's HTTP API, for the emails the app sends
// itself (Supabase sends its own auth emails through its SMTP settings). The
// key and the sender live in the environment; without them nothing is sent
// and each caller decides what that means for its own flow.

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email'

export interface BrevoMessage {
  to: string
  subject: string
  html: string
  text: string
}

export function brevoConfiguration() {
  const apiKey = process.env.BREVO_API_KEY?.trim()
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim()
  if (!apiKey || !senderEmail) return null
  return { apiKey, sender: { email: senderEmail, name: process.env.BREVO_SENDER_NAME?.trim() || undefined } }
}

/** Sends one message; resolves to Brevo's message id, throws on any refusal. */
export async function sendBrevoEmail(message: BrevoMessage) {
  const configuration = brevoConfiguration()
  if (!configuration) throw new Error('EMAIL_NOT_CONFIGURED')
  const response = await fetch(BREVO_SEND_URL, {
    method: 'POST',
    headers: {
      'api-key': configuration.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: configuration.sender,
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    }),
  })
  if (!response.ok) {
    // Brevo's own reason separates an unverified sender from a bad key or a
    // blocked recipient; the status alone does not.
    const reason = await response.text().catch(() => '')
    console.error('Brevo rejected an email.', { status: response.status, reason: reason.slice(0, 500) })
    throw new Error(`EMAIL_PROVIDER_${response.status}`)
  }
  const result = await response.json().catch(() => ({})) as { messageId?: string }
  return result.messageId ?? null
}
