// Issues a credit note for the newest real invoice inside a transaction that
// is always rolled back, so the shared database keeps no trace of the test.
import pg from 'pg'

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not configured.')

const { issueCreditNote } = await import('../server/utils/invoices.ts')
const pool = new pg.Pool({ connectionString })
const client = await pool.connect()
try {
  await client.query('BEGIN')
  const { rows: [original] } = await client.query(
    `SELECT id, organization_id, number, total_cents FROM invoices
     WHERE kind = 'invoice' ORDER BY issued_at DESC LIMIT 1`,
  )
  if (!original) throw new Error('No invoice to credit.')
  const note = await issueCreditNote(client, {
    organizationId: original.organization_id,
    invoiceId: original.id,
    reason: 'Test',
  })
  console.log('Original :', original.number, original.total_cents)
  console.log('Credit   :', note.number, note.kind, note.total, 'refers to', note.creditedInvoiceId === original.id)
  console.log('Sum = 0  :', Number(original.total_cents) + Math.round(note.total * 100) === 0)
  const again = await issueCreditNote(client, { organizationId: original.organization_id, invoiceId: note.id, reason: 'Test' })
    .then(() => 'allowed', (error: Error) => `rejected (${error.message})`)
  console.log('Credit a credit note:', again)
} finally {
  await client.query('ROLLBACK')
  client.release()
  await pool.end()
}
