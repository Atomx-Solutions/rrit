# Supabase auth email templates

Paste into Supabase -> Authentication -> Emails -> Templates.

| Template | Subject | File |
|---|---|---|
| Confirm sign up | Confirm your Framic account | `confirm-signup.html` |
| Reset password | Reset your Framic password | `reset-password.html` |
| Magic link or OTP | Your Framic sign-in link | `magic-link.html` |
| Change email address | Confirm your new email address | `change-email.html` |
| Invite user | Je shtuar si administrator i Framic | `invite-user.html` |

## Invite user: administrator invitation

The app sends the "Invite user" email only when a superadmin adds a platform
administrator (`server/utils/admin-platform-admins.ts`). It goes out through
the project's custom SMTP (Brevo) in Supabase -> Authentication -> Emails -> SMTP.

- The template is written in Albanian and English. The console passes
  `admin_invite_locale` (`sq` or `en`) and `admin_invited_by` in `.Data`.
- The button opens `<APP_URL>/admin/login`. Add that address (or `<APP_URL>/**`)
  to Supabase -> Authentication -> URL Configuration -> Redirect URLs, or
  Supabase falls back to the Site URL.
- Supabase does not invite an address that already has a confirmed account; the
  console then says so and the person signs in at `/admin/login` directly.
