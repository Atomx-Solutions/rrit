import { workspaceSchema } from '../../../shared/schemas/workspace'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query(
      'SELECT version,snapshot,created_at FROM business_brain_versions WHERE business_id=$1 ORDER BY version DESC LIMIT 20',
      [business.id],
    )
    return {
      versions: result.rows.map((row) => ({
        version: row.version as number,
        createdAt: new Date(row.created_at).toISOString(),
        brand: workspaceSchema.shape.brand.parse(row.snapshot),
      })),
    }
  })
})
