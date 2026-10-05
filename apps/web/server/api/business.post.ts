import { z } from 'zod'
import { emptyWorkspace } from '../../shared/utils/empty-workspace'
import { ianaTimezoneSchema } from '../../shared/schemas/brand'
import { recordAuditEvent, transitionMetadata } from '../utils/audit'
import { setTenantContext, setUserContext } from '../utils/database'
import { getBrandForBusiness } from '../utils/brands'
const schema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120),
  industry: z.string().max(200),
  description: z.string().trim().min(10).max(2000),
  voice: z.string().max(1000),
  audience: z.string().max(1000).default(''),
  goals: z.array(z.string().trim().min(2).max(120)).max(10).default([]),
  facts: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        text: z.string().max(1000),
        source: z.string().max(500),
        verified: z.boolean(),
      }),
    )
    .max(100)
    .default([]),
  timezone: ianaTimezoneSchema.default('Europe/Belgrade'),
  locale: z.enum(['sq-XK', 'en-US']).default('sq-XK'),
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
  Object.assign(state.brand, {
    name: parsed.data.name,
    city: parsed.data.city,
    industry: parsed.data.industry,
    description: parsed.data.description,
    voice: parsed.data.voice,
    audience: parsed.data.audience,
    goals: parsed.data.goals,
    facts: parsed.data.facts,
  })
  Object.assign(state.preferences, {
    timezone: parsed.data.timezone,
    locale: parsed.data.locale,
  })
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
    // An invited client already owns a business row, created on acceptance so
    // the organization keeps the id its package is attached to. Onboarding is
    // what fills that row, so the conflict updates it — but only while
    // onboarding has never completed, so a later submission can never
    // overwrite a workspace in use.
    const result = await client.query(
      `INSERT INTO businesses (owner_id, slug, state) VALUES ($1, $2, $3)
       ON CONFLICT (owner_id) DO UPDATE
         SET slug = EXCLUDED.slug, state = EXCLUDED.state, updated_at = now()
         WHERE COALESCE((businesses.state->>'onboarding')::integer, 0) = 0
       RETURNING id`,
      [user.id, slug, JSON.stringify(profile)],
    )
    const id =
      result.rows[0]?.id ||
      (await client.query('SELECT id FROM businesses WHERE owner_id = $1', [user.id])).rows[0].id
    // INSERT ... ON CONFLICT also applies the organizations SELECT policy, which
    // requires a membership the new owner does not have yet, so RLS rejects it.
    // An existing organization is visible to its owner (repeated onboarding);
    // otherwise a plain INSERT passes the policy's created_by check.
    const existingOrganization = await client.query('SELECT 1 FROM organizations WHERE id=$1', [id])
    if (!existingOrganization.rowCount)
      await client.query(
        'INSERT INTO organizations (id, slug, name, created_by) VALUES ($1, $2, $3, $4)',
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
      `INSERT INTO brands (organization_id, slug, name, profile, timezone, locale, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, slug) DO NOTHING
       RETURNING id`,
      [
        id,
        slug,
        parsed.data.name,
        JSON.stringify(state.brand),
        parsed.data.timezone,
        parsed.data.locale,
        parsed.data.industry.trim() || 'general',
      ],
    )
    if (result.rows.length) {
      const brandId = initialBrand.rows[0]?.id
      if (brandId) {
        for (const fact of parsed.data.facts) {
          const text = fact.text.trim()
          const source = fact.source.trim() || 'Plotësuar nga biznesi'
          if (!text) continue
          await client.query(
            `INSERT INTO brand_facts
              (organization_id, brand_id, kind, status, text, source, source_type, confidence, verified_at)
             VALUES ($1,$2,'explicit',$3,$4,$5,'manual',1,CASE WHEN $3='verified' THEN now() ELSE NULL END)`,
            [id, brandId, fact.verified ? 'verified' : 'proposed', text, source],
          )
        }
        const voice = parsed.data.voice.trim()
        if (voice) {
          await client.query(
            `INSERT INTO brand_voice_versions
              (organization_id, brand_id, version, text, source, active)
             VALUES ($1,$2,1,$3,$4,true)`,
            [id, brandId, voice, 'Plotësuar nga biznesi'],
          )
        }
      }
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
    const brand = await getBrandForBusiness(client, id, business.slug)
    if (brand) {
      business.workspace.brandRevision = brand.revision
      business.workspace.brand.status = brand.status
    }
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
