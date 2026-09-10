import { z } from 'zod'
import { emptyWorkspace } from '../../shared/utils/empty-workspace'
import { recordAuditEvent, transitionMetadata } from '../utils/audit'
import { setTenantContext, setUserContext } from '../utils/database'
const schema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120),
  industry: z.string().max(200),
  description: z.string().trim().min(10).max(2000),
  voice: z.string().max(1000),
})
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const parsed = schema.safeParse(await boundedBody(event, 16384))
  if (!parsed.success)
    throw createError({
      statusCode: 422,
      message: 'Plotëso emrin, qytetin dhe përshkrimin e biznesit.',
    })
  const state = emptyWorkspace(user.name, user.email)
  Object.assign(state.brand, parsed.data)
  state.onboarding = 1
  const { posts: _posts, assets: _assets, ...profile } = state
  const slug = parsed.data.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70)
    .padEnd(2, '0')
  const device = deviceIdentity(event)
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setUserContext(client, user.id)
    const result = await client.query(
      'INSERT INTO businesses (owner_id, slug, state) VALUES ($1, $2, $3) ON CONFLICT (owner_id) DO NOTHING RETURNING id',
      [user.id, slug, JSON.stringify(profile)],
    )
    const id =
      result.rows[0]?.id ||
      (await client.query('SELECT id FROM businesses WHERE owner_id = $1', [user.id])).rows[0].id
    await client.query(
      `INSERT INTO organizations (id, slug, name, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, slug, parsed.data.name, user.id],
    )
    await setTenantContext(client, { userId: user.id, organizationId: id })
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, brand_scope)
       VALUES ($1, $2, 'owner', 'ALL_BRANDS')
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [id, user.id],
    )
    const initialBrand = await client.query<{ id: string }>(
      `INSERT INTO brands (organization_id, slug, name, profile, settings, timezone, locale, category)
       VALUES ($1, $2, $3, $4, $5, 'Europe/Belgrade', 'sq-XK', $6)
       ON CONFLICT (organization_id, slug) DO NOTHING
       RETURNING id`,
      [
        id,
        slug,
        parsed.data.name,
        JSON.stringify(state.brand),
        JSON.stringify({
          emailApprovals: state.preferences.emailApprovals,
          emailPublished: state.preferences.emailPublished,
          emailTips: state.preferences.emailTips,
        }),
        parsed.data.industry.trim() || 'general',
      ],
    )
    if (result.rows.length) {
      await recordAuditEvent(client, {
        actorId: user.id,
        organizationId: id,
        resourceType: 'organization',
        resourceId: id,
        action: 'organization.created',
        metadata: transitionMetadata({
          status: ['absent', 'active'],
          name: [null, parsed.data.name],
          slug: [null, slug],
        }),
      })
      await recordAuditEvent(client, {
        actorId: user.id,
        organizationId: id,
        resourceType: 'membership',
        resourceId: `${id}:${user.id}`,
        action: 'membership.owner_granted',
        metadata: transitionMetadata({
          membership_status: ['absent', 'active'],
          role: [null, 'owner'],
          brand_scope: [null, 'ALL_BRANDS'],
        }),
      })
      if (initialBrand.rows[0])
        await recordAuditEvent(client, {
          actorId: user.id,
          organizationId: id,
          resourceType: 'brand',
          resourceId: initialBrand.rows[0].id,
          action: 'brand.created',
          metadata: transitionMetadata({
            status: [null, 'active'],
            name: [null, parsed.data.name],
            slug: [null, slug],
            city: [null, parsed.data.city],
            industry: [null, parsed.data.industry],
          }),
        })
      await grantTrial(client, id, user.email, device)
    }
    const business = await loadWorkspace(client, id, user.id)
    await client.query('COMMIT')
    setResponseStatus(event, 201)
    return business
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
