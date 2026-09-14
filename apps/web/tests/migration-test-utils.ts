export function isolateMigrationSql(sql: string, schema: string) {
  if (!/^rrit_(?:test|organizations|rls)_[a-f0-9]{32}$/.test(schema))
    throw new Error('Unsafe migration test schema')

  return sql
    .replaceAll(/\bpublic\./gi, `"${schema}".`)
    .replaceAll('SET search_path = public, pg_temp', `SET search_path = "${schema}", pg_temp`)
    .replaceAll(
      'SET search_path = pg_catalog, public',
      `SET search_path = pg_catalog, "${schema}"`,
    )
}
