import type { Pool } from 'pg'

type Reminder = {
  packageId: string
  organizationId: string
  organizationName: string
  packageName: string
  endsAt: Date
  email: string
}

function emailConfiguration() {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  return apiKey && from ? { apiKey, from } : null
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('sq-XK', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Belgrade',
  }).format(value)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}

async function sendReminder(reminder: Reminder) {
  const configuration = emailConfiguration()
  if (!configuration) throw new Error('EMAIL_NOT_CONFIGURED')
  const endDate = formatDate(reminder.endsAt)
  const dashboardUrl = `${(process.env.APP_URL || 'https://rrit.app').replace(/\/$/, '')}/app`
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${configuration.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `package-expiry-reminder:${reminder.packageId}`,
    },
    body: JSON.stringify({
      from: configuration.from,
      to: [reminder.email],
      subject: `Paketa jote skadon më ${endDate}`,
      text: `Përshëndetje,\n\nPaketa "${reminder.packageName}" për ${reminder.organizationName} skadon më ${endDate}. Hyr në Rrit për të kërkuar rinovimin ose kontakto ekipin tonë.\n\n${dashboardUrl}`,
      html: `<p>Përshëndetje,</p><p>Paketa <strong>${escapeHtml(reminder.packageName)}</strong> për ${escapeHtml(reminder.organizationName)} skadon më <strong>${escapeHtml(endDate)}</strong>.</p><p><a href="${escapeHtml(dashboardUrl)}">Hyr në Rrit</a> për të kërkuar rinovimin ose kontakto ekipin tonë.</p>`,
    }),
  })
  if (!response.ok) {
    // A bare status says a send failed but not why, which leaves an operator
    // guessing between an unverified sender, a restricted key and a rejected
    // recipient. The provider's own reason is logged; the stored code stays
    // short because the column is a code, not a message.
    const reason = await response.text().catch(() => '')
    console.error('Package expiry reminder rejected by the email provider.', {
      status: response.status,
      reason: reason.slice(0, 500),
    })
    throw new Error(`EMAIL_PROVIDER_${response.status}`)
  }
  const result = await response.json() as { id?: string }
  return result.id || null
}

/**
 * Claims due reminders in PostgreSQL before calling the provider. The provider
 * receives a package-scoped idempotency key, so a crash between delivery and
 * the final database update cannot produce a duplicate email.
 */
export async function runPackageExpiryReminderBatch(db: Pool) {
  if (!emailConfiguration()) return { sent: 0, skipped: 'email_not_configured' as const }
  const client = await db.connect()
  const reminders: Reminder[] = []
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rrit-package-expiry-reminders'))")
    const due = await client.query<{
      package_id: string; organization_id: string; organization_name: string; package_name: string; ends_at: Date; email: string
    }>(
      // The owner's address lives in auth.users, which this worker cannot
      // read. The definer function returns the rows that are due and nothing
      // else, so the reminder never needs access to that schema.
      'SELECT * FROM package_expiry_reminders_due()',
    )
    for (const row of due.rows) {
      const claimed = await client.query(
        `INSERT INTO package_expiry_reminders(package_id,organization_id,status,attempts,last_error_code,updated_at)
         VALUES($1,$2,'pending',1,NULL,now())
         ON CONFLICT(package_id) DO UPDATE
           SET status='pending',attempts=package_expiry_reminders.attempts+1,last_error_code=NULL,updated_at=now()
         WHERE package_expiry_reminders.status='failed'
         RETURNING package_id`,
        [row.package_id, row.organization_id],
      )
      if (claimed.rowCount) reminders.push({
        packageId: row.package_id, organizationId: row.organization_id, organizationName: row.organization_name,
        packageName: row.package_name, endsAt: row.ends_at, email: row.email,
      })
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  let sent = 0
  for (const reminder of reminders) {
    try {
      const providerMessageId = await sendReminder(reminder)
      await db.query(
        "UPDATE package_expiry_reminders SET status='sent',sent_at=now(),provider_message_id=$2,last_error_code=NULL,updated_at=now() WHERE package_id=$1 AND status='pending'",
        [reminder.packageId, providerMessageId],
      )
      sent++
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 120) : 'EMAIL_DELIVERY_FAILED'
      await db.query(
        "UPDATE package_expiry_reminders SET status='failed',last_error_code=$2,updated_at=now() WHERE package_id=$1 AND status='pending'",
        [reminder.packageId, code],
      )
      console.error('Package expiry reminder delivery failed.', { packageId: reminder.packageId, code })
    }
  }
  return { sent, skipped: null as null }
}
