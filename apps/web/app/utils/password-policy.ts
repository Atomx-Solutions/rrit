// The policy itself lives in shared/ because the server enforces it too, when
// it creates an invited client's account.
export {
  hasPasswordSymbol,
  passwordMeetsPolicy,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../shared/utils/password-policy'
