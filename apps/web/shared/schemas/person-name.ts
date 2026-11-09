// A person's name is letters in any alphabet, with the spaces, apostrophes,
// hyphens and dots names carry ("Anne-Marie O'Neil", "J. Smith"). Digits and
// symbols mean something other than a name was typed.
const personNamePattern = /^\p{L}[\p{L}\p{M}' .-]*$/u

// What a name field keeps of what is typed or pasted: digits and symbols never
// reach the value, so the field cannot hold something that is not a name.
export function keepPersonNameCharacters(value: string) {
  return value.replace(/[^\p{L}\p{M}' .-]/gu, '')
}

export function isPersonName(value: string) {
  return personNamePattern.test(value.trim())
}
