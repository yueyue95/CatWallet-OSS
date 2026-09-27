# Authentication

CatWallet uses Supabase Auth for all authentication. Google OAuth remains supported, and email/password authentication is available as an alternative provider.

## Supported providers

- Google OAuth
- Email and password

Do not add a custom authentication system or service-role based login flow. Client-rendered code must use the publishable Supabase key only.

## Supabase setup

Enable providers in the Supabase project used by the deployment:

- Authentication -> Providers -> Google
- Authentication -> Providers -> Email

The local Supabase configuration enables email/password sign-up with local email confirmation disabled. Local Google OAuth is intentionally disabled until the operator supplies their own Google OAuth client ID and client secret; no OAuth credentials are stored in this repository.

Local Supabase does not deliver mail to an external inbox. Password reset messages are captured by Inbucket at `http://127.0.0.1:56434`; open the latest `Reset your password` message there and follow its link.

Required local redirect URLs:

- `http://127.0.0.1:3000/auth/callback`
- `http://127.0.0.1:3000/auth/update-password`
- `http://localhost:3000/auth/callback`
- `http://localhost:3000/auth/update-password`
- `http://127.0.0.1:3000/auth/callback`
- `http://127.0.0.1:3000/auth/update-password`

Required production redirect URLs:

- `https://your-domain.com/auth/callback`
- `https://your-domain.com/auth/update-password`

The password reset request redirects through `/auth/callback?next=/auth/update-password` so the existing SSR callback can exchange the recovery code and establish the session before the password update form renders.

If sign-up returns HTTP 422, check Supabase Dashboard settings:

- Authentication -> Providers -> Email is enabled
- Authentication -> URL Configuration includes `http://localhost:3000/auth/callback` (and production equivalents)
- Sign-up passwords meet project rules (the app enforces at least 8 characters with lowercase, uppercase, a number, and a symbol, matching Supabase Email provider settings)
- The email is not already registered

## Environment variables

Set these values in `.env.local` for local development and in the deployment environment for production:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
# Docker-only server URL for SSR/middleware. Compose supplies the local host gateway by default.
# SUPABASE_SERVER_URL=http://host.docker.internal:56431
```

When CatWallet runs in Docker against the local Supabase stack, `SUPABASE_SERVER_URL` must be reachable from inside the container. `NEXT_PUBLIC_SUPABASE_URL` remains the browser-facing URL; do not use the browser loopback URL for container-side SSR unless it is reachable from that container.

Do not commit Supabase service-role keys, OAuth client secrets, refresh tokens, or access tokens.

## Onboarding defaults

New users created by Google OAuth and email/password both create rows in `auth.users`. The database trigger `on_auth_user_created` runs for both providers and creates:

- profile
- default categories
- default payment methods

Do not duplicate this default data creation in frontend code.

Email/password sign-up collects first and last name on the registration form. The app sends `full_name`, `first_name`, and `last_name` in Supabase `signUp` user metadata so `private.handle_new_user()` can populate `public.profiles.name` and settings can display the same fields as Google OAuth users.

## Terms of Use acceptance

`public.profiles.terms_accepted` tracks whether a user has accepted the Terms of Use and Privacy Policy. Email/password sign-up requires checking the acceptance box, which sends `terms_accepted: true` in `signUp` metadata so `private.handle_new_user()` sets the column on creation. Google OAuth sends no such metadata, so new Google sign-ups land with `terms_accepted = false`.

`AppShell` (rendered by every authenticated page) calls `requireAcceptedTerms()`, which redirects to `/auth/accept-terms` whenever the column is `false`. That page persists acceptance via a server action and redirects to `/dashboard`. Users that existed before this column was added were grandfathered in as already accepted by the migration backfill.

## Local flow

1. Enable Email in local Supabase. Configure Google only after supplying an OAuth client ID and secret.
2. Add the local redirect URLs above.
3. Run migrations.
4. Start the app with `pnpm run dev`.
5. Use email/password sign-in, email/password sign-up, or password reset from `/`. Google sign-in is available after its provider credentials are configured.
