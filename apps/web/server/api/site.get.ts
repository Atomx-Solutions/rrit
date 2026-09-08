export default defineEventHandler(() => ({
  operator: process.env.LEGAL_OPERATOR_NAME || null,
  privacyEmail: process.env.PRIVACY_EMAIL || null,
  supportEmail: process.env.SUPPORT_EMAIL || null,
}))
