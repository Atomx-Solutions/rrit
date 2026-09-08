import type { Pool, PoolClient } from 'pg'

const identifier = /^[a-z][a-z0-9_.-]{1,99}$/

export type OutboxMessage = {
  id: string
  topic: string
  deduplication_key: string
  schema_version: number
  payload: Record<string, unknown>
  attempt_count: number
}

export async function enqueueOutbox(
  client: PoolClient,
  input: {
    topic: string
    deduplicationKey: string
    payload: Record<string, unknown>
    schemaVersion?: number
    availableAt?: Date
  },
) {
  if (!identifier.test(input.topic)) throw new Error('invalid_outbox_topic')
  if (!input.deduplicationKey || input.deduplicationKey.length > 200)
    throw new Error('invalid_outbox_deduplication_key')
  const result = await client.query<OutboxMessage>(
    `INSERT INTO outbox_messages
       (topic, deduplication_key, schema_version, payload, available_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, now()))
     ON CONFLICT (topic, deduplication_key)
     DO UPDATE SET deduplication_key = EXCLUDED.deduplication_key
     RETURNING id, topic, deduplication_key, schema_version, payload, attempt_count`,
    [
      input.topic,
      input.deduplicationKey,
      input.schemaVersion ?? 1,
      JSON.stringify(input.payload),
      input.availableAt ?? null,
    ],
  )
  return result.rows[0]
}

async function claimOutboxMessage(
  db: Pool,
  topics: string[],
  leaseSeconds: number,
): Promise<OutboxMessage | undefined> {
  if (!topics.length || topics.some((topic) => !identifier.test(topic)))
    throw new Error('invalid_outbox_topics')
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<OutboxMessage>(
      `WITH candidate AS (
         SELECT id
         FROM outbox_messages
         WHERE topic = ANY($1::text[])
           AND (
             (status = 'pending' AND available_at <= now())
             OR (status = 'processing' AND locked_at < now() - ($2 * interval '1 second'))
           )
         ORDER BY available_at, created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE outbox_messages message
       SET status = 'processing', locked_at = now(), attempt_count = attempt_count + 1,
           last_error = NULL
       FROM candidate
       WHERE message.id = candidate.id
       RETURNING message.id, message.topic, message.deduplication_key,
                 message.schema_version, message.payload, message.attempt_count`,
      [topics, leaseSeconds],
    )
    await client.query('COMMIT')
    return result.rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function consumeNextOutbox(
  db: Pool,
  options: {
    consumer: string
    topics: string[]
    handler: (message: OutboxMessage, client: PoolClient) => Promise<void>
    leaseSeconds?: number
    maxAttempts?: number
    retrySeconds?: number
  },
) {
  if (!identifier.test(options.consumer)) throw new Error('invalid_outbox_consumer')
  const leaseSeconds = Math.min(Math.max(options.leaseSeconds ?? 300, 1), 3600)
  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? 10, 1), 100)
  const retrySeconds = Math.min(Math.max(options.retrySeconds ?? 5, 1), 3600)
  const message = await claimOutboxMessage(db, options.topics, leaseSeconds)
  if (!message) return { processed: 0 as const }

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const receipt = await client.query(
      'SELECT 1 FROM outbox_consumptions WHERE message_id=$1 AND consumer=$2',
      [message.id, options.consumer],
    )
    if (!receipt.rowCount) {
      await options.handler(message, client)
      await client.query(
        'INSERT INTO outbox_consumptions (message_id,consumer) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [message.id, options.consumer],
      )
    }
    await client.query(
      `UPDATE outbox_messages
       SET status='completed', locked_at=NULL, completed_at=now(), last_error=NULL
       WHERE id=$1 AND status='processing'`,
      [message.id],
    )
    await client.query('COMMIT')
    return { processed: 1 as const, completed: true as const, messageId: message.id }
  } catch (error) {
    await client.query('ROLLBACK')
    const reason = error instanceof Error ? error.message.slice(0, 500) : 'unknown_error'
    await db.query(
      `UPDATE outbox_messages
       SET status=CASE WHEN attempt_count >= $2 THEN 'dead' ELSE 'pending' END,
           locked_at=NULL,
           available_at=CASE WHEN attempt_count >= $2 THEN available_at ELSE now() + ($3 * interval '1 second') END,
           last_error=$4,
           completed_at=NULL
       WHERE id=$1 AND status='processing'`,
      [message.id, maxAttempts, retrySeconds, reason],
    )
    return { processed: 1 as const, completed: false as const, messageId: message.id }
  } finally {
    client.release()
  }
}
