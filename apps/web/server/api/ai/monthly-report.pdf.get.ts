import { editorialPlanSchema, monthSchema, researchSchema } from '../../../shared/schemas/monthly-plan'
import { monthlyReportPdf } from '../../utils/monthly-report-pdf'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = getQuery(event)
  const month = monthSchema.safeParse(typeof query.month === 'string' ? query.month : '')
  const type = query.type === 'strategy' ? 'strategy' : 'research'
  if (!month.success) throw createError({ statusCode: 422, message: 'server.MONTH_INVALID' })

  const pdf = await withBusinessTransaction(user.id, async (client, business) => {
    const { workspace } = await loadWorkspace(client, business.id, user.id)
    const result = await client.query(
      'SELECT research,editorial_plan FROM monthly_plans WHERE business_id=$1 AND month=$2::date',
      [business.id, `${month.data}-01`],
    )
    const row = result.rows[0]
    const research = row?.research ? researchSchema.parse(row.research) : null
    const strategy = row?.editorial_plan ? editorialPlanSchema.parse(row.editorial_plan) : null
    if (type === 'research' && !research)
      throw createError({ statusCode: 404, message: 'server.RESEARCH_NOT_READY' })
    if (type === 'strategy' && !strategy)
      throw createError({ statusCode: 404, message: 'server.STRATEGY_NOT_READY' })
    return monthlyReportPdf({
      type,
      language: workspace.preferences.locale === 'en-US' ? 'en' : 'sq',
      month: month.data,
      businessName: workspace.brand.name,
      businessDescription: workspace.brand.description || '',
      industry: workspace.brand.industry,
      city: workspace.brand.city,
      research,
      strategy,
    })
  })

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Content-Disposition', `attachment; filename="rrit-${type}-${month.data}.pdf"`)
  return pdf
})
