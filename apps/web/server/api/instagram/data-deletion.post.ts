// Meta calls this when a person asks for their data to be deleted.
export default defineEventHandler((event) => deleteProviderAccountData(event, 'instagram'))
