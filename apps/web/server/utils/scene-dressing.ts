// What any image or video may add to a photographed scene. What is added comes
// only from the products the business itself lists in My business, never from
// the model's idea of the kind of business, so nothing appears that the
// business does not sell.

import type { BrandFact } from '../../shared/schemas/business-brain'

/** The business's own verified products, as it wrote them in My business. */
export function businessProductsFromFacts(facts: Pick<BrandFact, 'kind' | 'verified' | 'text'>[]) {
  return [...new Set(facts
    .filter((fact) => fact.kind === 'product' && fact.verified)
    .map((fact) => fact.text.trim())
    .filter(Boolean))]
}

// What stays true of every dressed scene, whatever is added.
const untouched = 'Everything photographed stays exactly as it is: no existing product, person, furniture, architecture, sign or logo is moved, covered, replaced or deformed. Added items never carry text, logos, brand marks, prices or offers, and are never people.'

/** Told to every model that paints or animates a photograph. */
export function sceneDressingRule(products: string[]) {
  if (!products.length)
    return `Add no props, products, food or drinks to the scene: the business has listed none of its own products in My business, so the scene stays as photographed. ${untouched}`
  return `Dress the scene so it looks alive and in use, only with the business's own products as it lists them in My business: ${JSON.stringify(products)}. When the photograph shows empty surfaces (tables, counters, shelves, chairs) or free space, place on them those of these products that fit this post and naturally belong on that surface, as ordinary unbranded items true to their description, with only the plain, unbranded serving ware needed to present them (such as a cup, glass, plate or napkin). Never add a product, food, drink or item that is not on this list, not even a typical one for this kind of business. A usable surface is never negative space to keep empty when a listed product belongs there; only the zone where the type sits stays clear. Leave a surface bare when no listed product belongs there, or when the visual direction explicitly asks for an empty surface. This is part of the factual truth of the photograph, not a departure from it. ${untouched}`
}

/**
 * Told to the stages that write a slot's art direction, so they never forbid
 * what the painter is told to add and instead say what belongs there.
 */
export const sceneDressingDirection = 'The image stage dresses the scene: on empty surfaces it adds the business\'s own verified products (facts of kind product), as ordinary unbranded items, and nothing else. That is allowed and is not invention. So never write an assetDirection or visualLayout that forbids those products or asks to keep a table, counter or shelf empty; instead say which of them belong on those surfaces, preferring the products this slot cites, so the picture shows what the post says. Never direct the image to show a product, food or drink the business has not listed. People, text, logos, prices and changes to what was photographed stay forbidden.'

/** Told to every reviewer that compares a result with its photograph. */
export const sceneDressingReview = 'The business\'s own products as it lists them (verified facts of kind product), added as ordinary unbranded items on empty surfaces or in free space with plain serving ware and without changing anything photographed, are allowed scene dressing, not invention: never fail factuality, source fidelity or sameness for them. Any other added product, food or drink, and added people, text, logos, prices, offers, or any change to what was photographed still count.'
