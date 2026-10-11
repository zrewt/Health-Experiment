# Aevum

A minimal Expo SDK 57 / React Native app with email/password login, signup, a protected blank home page, and sign-out. There are no fitness tests, scoring engines, programs, family profiles, or domain-data stores.

## Run locally

Requires Node.js 22.13 or newer and npm.

```bash
npm ci
npx expo start
```

Press `w` for web, or open the app in Expo Go on a device.

## Supabase Auth setup

Keep your existing `.env.local`, or copy `.env.example` and set:

```ini
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
EXPO_PUBLIC_APP_ENV=development
```

Never use a service-role or secret key in the app. Restart Expo after environment changes. Without valid configuration, the auth screens show setup instructions and disable submission; they do not simulate successful login.

In Supabase Authentication:

- Enable the Email provider and email/password signups.
- Set the Site URL to a reachable confirmation landing page and configure allowed redirect URLs for your environment.
- With Confirm email enabled, signup shows a confirmation message. Open the email link, then return to the app and log in. Without confirmation, signup opens Home immediately.
- Configure mail delivery and rate limits before production use.

No application tables or SQL migrations are required. Supabase Auth manages accounts. Removing the old fitness schema from this checkout does **not** delete any existing remote tables, users, data, triggers, or deployed functions. Review those separately if you want to remove them; this change performs no remote cleanup.

## Routes and sessions

- `/auth/sign-in`: login.
- `/auth/sign-up`: signup.
- `/`: authenticated, otherwise redirected to login; blank except for Home and Sign out.

Expo Router protected routes prevent signed-out navigation to Home. Supabase persists only the auth session through AsyncStorage, restores it on launch, and refreshes it. Sign out affects this device/session and reports errors instead of pretending it succeeded. Old anonymous sessions do not grant access to Home.

Password recovery, social login, account deletion, and app-specific content are intentionally outside this clean slate.

## Verification

```bash
npm run typecheck
npm run lint
npm run test:auth
npm run test:env
node scripts/contrast-sanity.cjs
npx expo-doctor
```

Auth helper tests use isolated SDK response fixtures. They cover validation, errors, immediate signup, and confirmation-required signup; they do not prove a live Supabase account works. Email delivery, real-account login/signup, native session persistence, and device behavior require configured credentials and device/account testing.
