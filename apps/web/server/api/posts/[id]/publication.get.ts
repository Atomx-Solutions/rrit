import { z } from 'zod'
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 404 })
  const result = await withBusinessTransaction(user.id, async (client, business) => {
    const row = await client.query(
      'SELECT id,status,run_at,updated_at,provider_post_id,failure_code,retry_count,max_attempts,attempt_count,last_attempt_at FROM publication_jobs WHERE post_id=$1 AND business_id=$2 ORDER BY created_at DESC LIMIT 1',
      [id.data, business.id],
    )
    const job = row.rows[0]
    const attempts = job
      ? await client.query(
          'SELECT attempt_number,event_type,request_hash,failure_code,provider_post_id,created_at FROM publication_attempts WHERE job_id=$1 AND business_id=$2 ORDER BY attempt_number,id',
          [job.id, business.id],
        )
      : { rows: [] }
    return { job, attempts }
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  const job = result.job
  const failureCode = job?.failure_code as string | null
  return {
    job: job
      ? {
          status: job.status as string,
          runAt: job.run_at.toISOString() as string,
          updatedAt: job.updated_at.toISOString() as string,
          providerPostId: job.provider_post_id as string | null,
          failureCode,
          disposition: publicationFailureDisposition(job.status as string, failureCode),
          remediation: publicationRemediation(failureCode),
          attempt: Number(job.retry_count) + 1,
          workerAttempts: Number(job.attempt_count),
          maxAttempts: Number(job.max_attempts),
          lastAttemptAt: (job.last_attempt_at as Date | null)?.toISOString() ?? null,
        }
      : null,
    ...(job
      ? {
          attempts: result.attempts.rows.map((attempt) => ({
            attempt: Number(attempt.attempt_number),
            event: attempt.event_type as string,
            requestHash: attempt.request_hash as string,
            failureCode: attempt.failure_code as string | null,
            providerPostId: attempt.provider_post_id as string | null,
            createdAt: (attempt.created_at as Date).toISOString(),
          })),
        }
      : {}),
  }
})
