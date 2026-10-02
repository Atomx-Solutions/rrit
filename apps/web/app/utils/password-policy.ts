export const PASSWORD_MIN_LENGTH = 12

// Keep this set aligned with Supabase Auth's supported required symbols.
const PASSWORD_SYMBOL = /[!@#$%^&*()_+\-=[\]{};'":\\|,.<>/?`~]/

export function hasPasswordSymbol(password: string) {
  return PASSWORD_SYMBOL.test(password)
}
