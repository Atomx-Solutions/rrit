import { monthlyPlannerReadiness } from '../../utils/monthly-ai'

export default defineEventHandler(async (event) => {
  try {
    const result = await database().query(
      `SELECT
        EXISTS (SELECT 1 FROM schema_migrations WHERE name='0019_tenant_rls_reconcile.sql')
          AND EXISTS (SELECT 1 FROM schema_migrations WHERE name='0023_signed_storage_reader.sql')
          AND EXISTS (SELECT 1 FROM schema_migrations WHERE name='20260910143200_secure_global_operational_tables.sql') AS migrated,
        EXISTS (SELECT 1 FROM worker_heartbeats WHERE name='publisher' AND last_seen_at>now()-interval '2 minutes') AS publisher_alive,
        EXISTS (SELECT 1 FROM worker_heartbeats WHERE name='monthly_planner' AND last_seen_at>now()-interval '2 minutes') AS planner_alive,
        (SELECT count(*)::integer FROM publication_jobs WHERE status='pending') AS pending_jobs,
        (SELECT COALESCE(EXTRACT(EPOCH FROM now()-min(run_at)),0)::integer FROM publication_jobs WHERE status='pending' AND run_at<=now()) AS oldest_due_seconds`,
    )
    const state = result.rows[0]
    if (!state?.migrated) {
      setResponseStatus(event, 503)
      setHeader(event, 'Cache-Control', 'no-store')
      return {
        status: 'not_ready' as const,
        database: 'ready' as const,
        migrations: 'pending' as const,
      }
    }
    const publishingEnabled = process.env.PUBLISHING_ENABLED === 'true'
    const publishingRequired = process.env.PUBLISHING_REQUIRED === 'true' || publishingEnabled
    const planner = monthlyPlannerReadiness(state.planner_alive === true)
    if (
      (publishingRequired && !state.publisher_alive) ||
      ['misconfigured', 'unavailable'].includes(planner)
    ) {
      setResponseStatus(event, 503)
      setHeader(event, 'Cache-Control', 'no-store')
      return {
        status: 'not_ready' as const,
        database: 'ready' as const,
        migrations: 'ready' as const,
        publisher: publishingRequired
          ? state.publisher_alive
            ? ('ready' as const)
            : ('unavailable' as const)
          : ('disabled' as const),
        monthlyPlanner: planner,
        pendingJobs: state.pending_jobs as number,
        oldestDueSeconds: state.oldest_due_seconds as number,
      }
    }
    setHeader(event, 'Cache-Control', 'no-store')
    return {
      status: 'ready' as const,
      database: 'ready' as const,
      migrations: 'ready' as const,
      publisher: publishingRequired ? ('ready' as const) : ('disabled' as const),
      monthlyPlanner: planner,
      pendingJobs: state.pending_jobs as number,
      oldestDueSeconds: state.oldest_due_seconds as number,
    }
  } catch {
    setResponseStatus(event, 503)
    setHeader(event, 'Cache-Control', 'no-store')
    return { status: 'not_ready' as const, database: 'unavailable' as const }
  }
})
