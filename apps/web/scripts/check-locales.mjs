import fs from 'node:fs'
import path from 'node:path'

const localeDir = path.resolve('app/locales/client')
// German is checked alongside the other two. It used to be left out, which let
// it fall more than a thousand keys behind while the build stayed green: the
// German UI silently rendered English wherever a key was missing.
const localeFiles = ['sq.json', 'en.json', 'de.json']
const parsed = new Map()

for (const file of localeFiles) {
  const filename = path.join(localeDir, file)
  const source = fs.readFileSync(filename, 'utf8')
  const keys = [...source.matchAll(/^\s*,?\s*"((?:\\.|[^"\\])+)"\s*:/gm)].map((match) => match[1])
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
  if (duplicates.length) {
    throw new Error(`${file} has duplicate keys: ${[...new Set(duplicates)].join(', ')}`)
  }
  parsed.set(file, JSON.parse(source))
}

// Albanian is the source language, so every other file is compared against it
// in both directions: a key it is missing would fall back to another language,
// and a key it alone carries is one nobody has translated.
const sq = parsed.get('sq.json')
const sqKeys = Object.keys(sq)
const differences = localeFiles
  .filter((file) => file !== 'sq.json')
  .flatMap((file) => {
    const other = parsed.get(file)
    const missing = sqKeys.filter((key) => !(key in other))
    const extra = Object.keys(other).filter((key) => !(key in sq))
    return missing.length || extra.length
      ? [`${file}: missing ${missing.length ? missing.join(', ') : 'none'}; not in sq: ${extra.length ? extra.join(', ') : 'none'}`]
      : []
  })
if (differences.length) {
  throw new Error(`Locale keys differ. ${differences.join(' | ')}`)
}

console.log(`Locales are valid: ${sqKeys.length} unique keys in ${localeFiles.join(', ')}.`)
