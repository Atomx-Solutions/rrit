import { packageRequestPostOptions, packageRequestPostPrice, packageRequestVideoPrice, packageRequestCurrency } from '../utils/package-requests'

// The amounts the public form offers as a starting point. They are a setting,
// so the form never carries a list of its own.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  // The price is public: a visitor should know what a post costs before
  // being asked for a phone number.
  const [postOptions, postPriceCents, videoPriceCents, currency] = await Promise.all([
    packageRequestPostOptions(),
    packageRequestPostPrice(),
    packageRequestVideoPrice(),
    packageRequestCurrency(),
  ])
  return { postOptions, postPriceCents, videoPriceCents, currency }
})
