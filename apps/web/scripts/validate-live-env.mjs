const required = {
  PADDLE_ENABLED: value => value === 'true',
  PADDLE_ENV: value => value === 'production',
  PADDLE_API_KEY: value => value?.startsWith('pdl_live_'),
  PADDLE_CLIENT_TOKEN: value => value?.startsWith('live_'),
  PADDLE_PRODUCT_ID: value => /^pro_[a-z\d]{26}$/.test(value || ''),
  PADDLE_PACKAGE_PRICE_ID: value => /^pri_[a-z\d]{26}$/.test(value || ''),
  PADDLE_WEBHOOK_SECRET: value => Boolean(value?.trim()),
}

const invalid = Object.entries(required)
  .filter(([name, valid]) => !valid(process.env[name]))
  .map(([name]) => name)

if (process.env.NUXT_PUBLIC_PADDLE_ENV && process.env.NUXT_PUBLIC_PADDLE_ENV !== 'production')
  invalid.push('NUXT_PUBLIC_PADDLE_ENV')
if (process.env.NUXT_PUBLIC_PADDLE_CLIENT_TOKEN && !process.env.NUXT_PUBLIC_PADDLE_CLIENT_TOKEN.startsWith('live_'))
  invalid.push('NUXT_PUBLIC_PADDLE_CLIENT_TOKEN')
if (process.env.NUXT_PUBLIC_PADDLE_PACKAGE_PRICE_ID && process.env.NUXT_PUBLIC_PADDLE_PACKAGE_PRICE_ID !== process.env.PADDLE_PACKAGE_PRICE_ID)
  invalid.push('NUXT_PUBLIC_PADDLE_PACKAGE_PRICE_ID')

if (invalid.length)
  throw new Error(`Paddle live configuration is incomplete or mismatched: ${invalid.join(', ')}`)

// The local live smoke test must not start background database workers.
process.env.PROCESS_ROLE = 'web'
