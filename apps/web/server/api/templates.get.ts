import { templateSchema } from '../../shared/schemas/catalog'
export default defineEventHandler(async () => {
  const result = await database().query(
    'SELECT payload FROM post_templates WHERE active = true ORDER BY sort_order',
  )
  return templateSchema.array().parse(result.rows.map((row) => row.payload))
})
