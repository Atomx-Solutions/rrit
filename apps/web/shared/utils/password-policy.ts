export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

// Keep this set aligned with Supabase Auth's supported required symbols.
const PASSWORD_SYMBOL = /[!@#$%^&*()_+\-=[\]{};'":\\|,.<>/?`~]/

export function hasPasswordSymbol(password: string) {
  return PASSWORD_SYMBOL.test(password)
}

// An invited client's account is created on the server, so the policy the form
// shows and the policy the server enforces must be the same one.
export function passwordMeetsPolicy(password: string) {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    hasPasswordSymbol(password)
  )
}
