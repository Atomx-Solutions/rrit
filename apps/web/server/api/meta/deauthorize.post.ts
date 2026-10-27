// Meta calls this when a person removes Framic from their account.
export default defineEventHandler((event) => deauthorizeProviderAccount(event, 'facebook'))
