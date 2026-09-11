import { organizationCreateSchema } from '../../shared/schemas/organization'

export function slugFromOrganizationName(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return slug.length >= 2 ? slug : `${slug}-org`
}

export function organizationFormMessage(input: { name: string; slug: string }) {
  const result = organizationCreateSchema.safeParse({
    name: input.name.trim(),
    slug: input.slug.trim().toLowerCase(),
  })
  return result.success ? null : 'Kontrollo emrin dhe slug-un e organizatës.'
}
