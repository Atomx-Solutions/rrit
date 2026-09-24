import fs from 'node:fs'
import path from 'node:path'

const localeDir = path.resolve('app/locales/client')
const localeFiles = ['sq.json', 'en.json']
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

const sq = parsed.get('sq.json')
const en = parsed.get('en.json')
const sqKeys = Object.keys(sq)
const enKeys = Object.keys(en)
const missingInEnglish = sqKeys.filter((key) => !(key in en))
const missingInAlbanian = enKeys.filter((key) => !(key in sq))
if (missingInEnglish.length || missingInAlbanian.length) {
  throw new Error(
    `Locale keys differ. Missing in en: ${missingInEnglish.join(', ')}. Missing in sq: ${missingInAlbanian.join(', ')}.`,
  )
}

console.log(`Locales are valid: ${sqKeys.length} unique keys in sq.json and en.json.`)
